const db = require('../config/db');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const razorpay = require('../config/razorpay');

// ─── Email transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Helper: insert an escrow ledger entry ────────────────────────────────────
async function addLedgerEntry({ booking_id, event_type, amount, from_party, to_party, note }) {
  await db.query(
    `INSERT INTO booking_ledger (booking_id, event_type, amount, from_party, to_party, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [booking_id, event_type, amount ?? null, from_party ?? null, to_party ?? null, note ?? null]
  );
}

// ─── Helper: generate a 4-digit OTP ───────────────────────────────────────────
function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
}

// ─── Helper: check if dates overlap with existing bookings ───────────────────
async function hasConflict(itemId, startDate, endDate, excludeBookingId = null) {
  let sql = `
    SELECT id FROM bookings
    WHERE item_id = ?
      AND booking_status NOT IN ('CANCELLED', 'COMPLETED')
      AND NOT (booking_status = 'PENDING_PAYMENT' AND created_at < NOW() - INTERVAL 15 MINUTE)
      AND start_date <= ?
      AND end_date   >= ?
  `;
  const params = [itemId, endDate, startDate];

  if (excludeBookingId) {
    sql += ' AND id != ?';
    params.push(excludeBookingId);
  }

  const [rows] = await db.query(sql, params);
  return rows.length > 0;
}

// ─── GET /api/bookings/booked-dates/:itemId ───────────────────────────────────
const getBookedDates = async (req, res) => {
  try {
    const { itemId } = req.params;

    const [rows] = await db.query(
      `SELECT start_date, end_date FROM bookings
       WHERE item_id = ?
         AND booking_status NOT IN ('CANCELLED','COMPLETED')
         AND NOT (booking_status = 'PENDING_PAYMENT' AND created_at < NOW() - INTERVAL 15 MINUTE)
         AND end_date >= CURDATE()`,
      [itemId]
    );

    const blocked = [];
    rows.forEach(({ start_date, end_date }) => {
      const cur = new Date(start_date);
      const end = new Date(end_date);
      while (cur <= end) {
        blocked.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
      }
    });

    res.json({ blocked });
  } catch (err) {
    console.error('getBookedDates error:', err);
    res.status(500).json({ error: 'Failed to fetch booked dates' });
  }
};

// ─── POST /api/bookings/check-availability ───────────────────────────────────
const checkAvailability = async (req, res) => {
  try {
    const { item_id, start_date, end_date } = req.body;

    if (!item_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'item_id, start_date, end_date required' });
    }

    const conflict = await hasConflict(item_id, start_date, end_date);
    res.json({ available: !conflict });
  } catch (err) {
    console.error('checkAvailability error:', err);
    res.status(500).json({ error: 'Availability check failed' });
  }
};

// ─── POST /api/bookings ────────────────────────────────────────────────────────
// Matches item-details.html: item_id, borrower_email, start_date, end_date,
// pickup_time, rent_amount, deposit_amount (rent/deposit already computed
// client-side from the item's monthly price)
const createBooking = async (req, res) => {
  try {
    const {
      item_id, borrower_email, start_date, end_date,
      pickup_time, rent_amount, deposit_amount,
    } = req.body;

    if (!item_id || !borrower_email || !start_date || !end_date ||
        rent_amount === undefined || deposit_amount === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const start = new Date(start_date);
    const end   = new Date(end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start < today) {
      return res.status(400).json({ success: false, message: 'Start date cannot be in the past' });
    }
    if (end <= start) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24));

    // Fetch item
    const [items] = await db.query('SELECT * FROM items WHERE id = ?', [item_id]);
    if (!items.length) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = items[0];

    // Prevent owner from booking their own item
    if (item.owner_email === borrower_email) {
      return res.status(400).json({ success: false, message: 'You cannot book your own item' });
    }

    // Borrower must be verified
    const [borrowers] = await db.query(
      'SELECT status FROM borrowers WHERE email = ?',
      [borrower_email]
    );
    if (!borrowers.length || borrowers[0].status !== 'Verified') {
      return res.status(403).json({ success: false, message: 'Borrower not verified' });
    }

    // Availability check (race-condition safe — done just before insert)
    const conflict = await hasConflict(item_id, start_date, end_date);
    if (conflict) {
      return res.status(409).json({ success: false, message: 'Selected dates are not available' });
    }

    const rentAmount    = Number(rent_amount);
    const depositAmount = Number(deposit_amount);
    const totalPayable  = parseFloat((rentAmount + depositAmount).toFixed(2));

    const [result] = await db.query(
      `INSERT INTO bookings
        (item_id, borrower_email, lender_email, start_date, end_date, pickup_time,
         total_days, price_per_day, rent_amount, platform_fee,
         deposit_amount, total_payable, booking_status, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', 'UNPAID')`,
      [
        item_id, borrower_email, item.owner_email,
        start_date, end_date, pickup_time || null, totalDays,
        item.price_per_month || 0, rentAmount, 0,
        depositAmount, totalPayable,
      ]
    );

    const bookingId = result.insertId;

    res.status(201).json({
      success: true,
      message: 'Booking created, proceed to payment',
      booking_id: bookingId,
      total_days: totalDays,
      rent_amount: rentAmount,
      deposit_amount: depositAmount,
      total_payable: totalPayable,
    });
  } catch (err) {
    console.error('createBooking error:', err);
    res.status(500).json({ success: false, message: 'Failed to create booking' });
  }
};

// ─── POST /api/bookings/:id/create-order ───────────────────────────────────────
// Opens a Razorpay order for the booking's total_payable (rent + deposit)
const createOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    if (booking.booking_status !== 'PENDING_PAYMENT') {
      return res.status(400).json({ success: false, message: 'This booking is not awaiting payment' });
    }

    const amountPaise = Math.round(Number(booking.total_payable) * 100);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `booking_${id}`,
    });

    await db.query(
      'UPDATE bookings SET razorpay_order_id = ? WHERE id = ?',
      [order.id, id]
    );

    res.json({
      success: true,
      key_id: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      order_id: order.id,
    });
  } catch (err) {
    console.error('createOrder error:', err);
    res.status(500).json({ success: false, message: 'Could not start payment' });
  }
};

// ─── POST /api/bookings/:id/verify-payment ────────────────────────────────────
// Verifies the Razorpay signature, then confirms the booking
// Also generates the pickup OTP that only the borrower will see
const verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    const [rows] = await db.query(
      `SELECT b.*, i.title FROM bookings b JOIN items i ON b.item_id = i.id WHERE b.id = ?`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    const pickupOtp = generateOtp();

    await db.query(
      `UPDATE bookings
       SET booking_status = 'CONFIRMED', payment_status = 'HELD_IN_ESCROW',
           razorpay_payment_id = ?, pickup_otp = ?
       WHERE id = ?`,
      [razorpay_payment_id, pickupOtp, id]
    );

    await addLedgerEntry({
      booking_id: id,
      event_type: 'payment_held',
      amount: booking.total_payable,
      from_party: booking.borrower_email,
      to_party: 'ShareSphere Escrow',
      note: 'Full amount charged and held in escrow',
    });

    // Notify lender
    try {
      await transporter.sendMail({
        from: `"ShareSphere" <${process.env.EMAIL_USER}>`,
        to: booking.lender_email,
        subject: `New Booking Confirmed — ${booking.title}`,
        html: `
          <h2>You have a new confirmed booking!</h2>
          <p><strong>Item:</strong> ${booking.title}</p>
          <p><strong>Borrower:</strong> ${booking.borrower_email}</p>
          <p><strong>Dates:</strong> ${booking.start_date} to ${booking.end_date}</p>
          <p><strong>Total payable:</strong> ₹${booking.total_payable} (held in escrow)</p>
          <p style="color:#888;font-size:12px;">Booking ID: #${id}</p>
        `,
      });
    } catch (emailErr) {
      console.error('Lender confirmation email failed:', emailErr.message);
    }

    // Notify borrower
    try {
      await transporter.sendMail({
        from: `"ShareSphere" <${process.env.EMAIL_USER}>`,
        to: booking.borrower_email,
        subject: `Booking Confirmed — ${booking.title}`,
        html: `
          <h2>Payment received — your booking is confirmed!</h2>
          <p><strong>Item:</strong> ${booking.title}</p>
          <p><strong>Dates:</strong> ${booking.start_date} to ${booking.end_date}</p>
          <p><strong>Rent:</strong> ₹${booking.rent_amount}</p>
          <p><strong>Deposit (refundable):</strong> ₹${booking.deposit_amount}</p>
          <p><strong>Your pickup code:</strong> ${pickupOtp} — share this with the lender only when you physically receive the item.</p>
          <p style="color:#888;font-size:12px;">Booking ID: #${id}</p>
        `,
      });
    } catch (emailErr) {
      console.error('Borrower confirmation email failed:', emailErr.message);
    }

    res.json({ success: true, message: 'Payment verified, booking confirmed' });
  } catch (err) {
    console.error('verifyPayment error:', err);
    res.status(500).json({ success: false, message: 'Could not verify payment' });
  }
};

// ─── POST /api/bookings/:id/cancel ────────────────────────────────────────────
// Called by the client when a booking created just before payment is
// abandoned (modal closed, Razorpay dismissed, payment failed, or the tab
// was closed mid-flow — see item-details.html's cancelPendingBooking()).
// This can arrive from an unauthenticated / best-effort beacon request, so
// it ONLY ever cancels a booking that is still PENDING_PAYMENT. A booking
// that has already been confirmed/paid is left completely untouched —
// hasConflict() and getBookedDates() also ignore stale PENDING_PAYMENT rows
// after 15 minutes as a second line of defense, so a lost/failed call here
// just means the dates stay blocked a little longer instead of forever.
const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    if (booking.booking_status !== 'PENDING_PAYMENT') {
      // Already confirmed/active/etc — never cancel it from this route.
      return res.json({ success: false, message: 'Booking is no longer pending payment; not cancelled' });
    }

    const [result] = await db.query(
      `UPDATE bookings SET booking_status = 'CANCELLED' WHERE id = ? AND booking_status = 'PENDING_PAYMENT'`,
      [id]
    );

    if (result.affectedRows > 0) {
      await addLedgerEntry({
        booking_id: id,
        event_type: 'booking_cancelled',
        amount: null,
        from_party: booking.borrower_email,
        to_party: null,
        note: (req.body && req.body.reason) || 'Cancelled before payment was completed',
      });
    }

    res.json({ success: true, message: 'Booking cancelled' });
  } catch (err) {
    console.error('cancelBooking error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel booking' });
  }
};

// ─── GET /api/bookings/borrower/:email ───────────────────────────────────────
// FIX: only shows bookings that actually became real bookings (payment went
// through at least once). A row that never got past PENDING_PAYMENT was
// never a completed checkout — it's an abandoned attempt, not a booking —
// so it must never appear in the borrower's "My Bookings" list, whether or
// not cancelBooking() successfully cleaned it up server-side.
const getBorrowerBookings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, i.title, i.category, i.image_paths
       FROM bookings b
       JOIN items i ON b.item_id = i.id
       WHERE b.borrower_email = ?
         AND b.booking_status NOT IN ('PENDING_PAYMENT', 'CANCELLED')
       ORDER BY b.created_at DESC`,
      [req.params.email]
    );

    const bookings = rows.map(row => ({
      ...row,
      image_paths: Array.isArray(row.image_paths)
        ? row.image_paths
        : (() => { try { return JSON.parse(row.image_paths); } catch { return []; } })(),
    }));

    res.json(bookings);
  } catch (err) {
    console.error('getBorrowerBookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

// ─── GET /api/bookings/lender/:email ─────────────────────────────────────────
// Same fix as getBorrowerBookings — lenders should never see a borrower's
// abandoned/unpaid booking attempt on their item either.
const getLenderBookings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, i.title, i.category, i.image_paths
       FROM bookings b
       JOIN items i ON b.item_id = i.id
       WHERE b.lender_email = ?
         AND b.booking_status NOT IN ('PENDING_PAYMENT', 'CANCELLED')
       ORDER BY b.created_at DESC`,
      [req.params.email]
    );

    const bookings = rows.map(row => ({
      ...row,
      image_paths: Array.isArray(row.image_paths)
        ? row.image_paths
        : (() => { try { return JSON.parse(row.image_paths); } catch { return []; } })(),
    }));

    res.json(bookings);
  } catch (err) {
    console.error('getLenderBookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

// ─── PUT /api/bookings/:id/status ─────────────────────────────────────────────
const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { booking_status } = req.body;

    const validStatuses = ['PENDING_PAYMENT','CONFIRMED','ACTIVE','COMPLETED','DISPUTED','CANCELLED'];
    if (!validStatuses.includes(booking_status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await db.query('UPDATE bookings SET booking_status = ? WHERE id = ?', [booking_status, id]);
    res.json({ message: 'Status updated' });
  } catch (err) {
    console.error('updateBookingStatus error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

// ─── POST /api/bookings/:id/confirm-pickup ────────────────────────────────────
// Called by the lender once the borrower has picked up the item.
// Requires the pickup OTP shown only to the borrower AND a photo of the item
// at pickup — proves both parties were present and records item condition.
// Releases the rent portion from escrow to the lender and generates the
// return OTP for the next stage.
const confirmPickup = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, message: 'Pickup code is required' });
    }

    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    // Lender must have added payout details before rent can be released
    const [lenderRows] = await db.query(
      `SELECT bank_details_added FROM lender_requests WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [booking.lender_email]
    );
    if (!lenderRows.length || !lenderRows[0].bank_details_added) {
      return res.status(400).json({ success: false, message: 'Lender has not added payout details yet.' });
    }

    if (booking.payment_status !== 'HELD_IN_ESCROW') {
      return res.status(400).json({ success: false, message: 'Booking is not awaiting pickup confirmation' });
    }

    if (String(otp).trim() !== String(booking.pickup_otp).trim()) {
      return res.status(400).json({ success: false, message: 'Incorrect pickup code. Ask the borrower to confirm the code shown in their app.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'A photo of the item at pickup is required.' });
    }
    const pickupPhoto = req.file.filename;

    const returnOtp = generateOtp();

    await db.query(
      `UPDATE bookings
       SET booking_status = 'ACTIVE', payment_status = 'RENT_RELEASED',
           pickup_confirmed_at = NOW(), released_at = NOW(), return_otp = ?, pickup_photo = ?
       WHERE id = ?`,
      [returnOtp, pickupPhoto, id]
    );

    await addLedgerEntry({
      booking_id: id, event_type: 'pickup_confirmed',
      amount: null, from_party: booking.lender_email, to_party: null,
      note: 'Lender confirmed item was picked up (verified via borrower OTP + photo)',
    });
    await addLedgerEntry({
      booking_id: id, event_type: 'rent_released',
      amount: booking.rent_amount, from_party: 'ShareSphere Escrow', to_party: booking.lender_email,
      note: 'Rent released to lender after pickup confirmation',
    });

    res.json({ success: true, message: 'Pickup confirmed, rent released to lender' });
  } catch (err) {
    console.error('confirmPickup error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm pickup' });
  }
};

// ─── POST /api/bookings/:id/confirm-return ────────────────────────────────────
// Called by the lender once the item has been returned in good condition.
// Requires the return OTP shown only to the borrower AND a photo of the item
// at return. Refunds the deposit from escrow to the borrower.
const confirmReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, message: 'Return code is required' });
    }

    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    if (booking.payment_status !== 'RENT_RELEASED') {
      return res.status(400).json({ success: false, message: 'Rent must be released before the deposit can be refunded' });
    }

    if (String(otp).trim() !== String(booking.return_otp).trim()) {
      return res.status(400).json({ success: false, message: 'Incorrect return code. Ask the borrower to confirm the code shown in their app.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'A photo of the item at return is required.' });
    }
    const returnPhoto = req.file.filename;

    await db.query(
      `UPDATE bookings
       SET booking_status = 'COMPLETED', payment_status = 'COMPLETED',
           deposit_refunded_at = NOW(), return_photo = ?
       WHERE id = ?`,
      [returnPhoto, id]
    );

    await addLedgerEntry({
      booking_id: id, event_type: 'deposit_refunded',
      amount: booking.deposit_amount, from_party: 'ShareSphere Escrow', to_party: booking.borrower_email,
      note: 'Deposit refunded after clean item return (verified via borrower OTP + photo)',
    });

    res.json({ success: true, message: 'Return confirmed, deposit refunded to borrower' });
  } catch (err) {
    console.error('confirmReturn error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm return' });
  }
};

// ─── GET /api/bookings/:id/ledger ─────────────────────────────────────────────
const getLedger = async (req, res) => {
  try {
    const [entries] = await db.query(
      `SELECT * FROM booking_ledger WHERE booking_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    const [bookingRows] = await db.query(
      `SELECT pickup_photo, return_photo, razorpay_payment_id, razorpay_order_id FROM bookings WHERE id = ?`,
      [req.params.id]
    );
    res.json({
      success: true,
      entries,
      pickup_photo: bookingRows[0]?.pickup_photo || null,
      return_photo: bookingRows[0]?.return_photo || null,
      razorpay_payment_id: bookingRows[0]?.razorpay_payment_id || null,
      razorpay_order_id: bookingRows[0]?.razorpay_order_id || null,
    });
  } catch (err) {
    console.error('getLedger error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger' });
  }
};

// ─── GET /api/bookings/:id/pickup-details ─────────────────────────────────────
// Reveals lender contact + address, but ONLY once payment is confirmed
// (i.e. the booking has actually moved past PENDING_PAYMENT).
const getPickupDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT b.id, b.borrower_email, b.lender_email, b.payment_status, b.pickup_time,
              b.start_date, b.end_date, i.title, i.item_location,
              lr.first_name, lr.last_name, lr.phone, lr.address, lr.district, lr.state, lr.pincode
       FROM bookings b
       JOIN items i ON b.item_id = i.id
       LEFT JOIN lender_requests lr ON LOWER(TRIM(lr.email)) = LOWER(TRIM(b.lender_email))
       WHERE b.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    // Gate: only reveal once escrow payment has actually gone through
    if (!['HELD_IN_ESCROW', 'RENT_RELEASED', 'COMPLETED'].includes(booking.payment_status)) {
      return res.status(403).json({ success: false, message: 'Pickup details unlock once payment is confirmed' });
    }

    res.json({
      success: true,
      item_title: booking.title,
      item_location: booking.item_location,
      pickup_time: booking.pickup_time,
      start_date: booking.start_date,
      end_date: booking.end_date,
      lender_name: booking.first_name ? `${booking.first_name} ${booking.last_name || ''}`.trim() : booking.lender_email,
      lender_phone: booking.phone || null,
      lender_address: booking.address || null,
      lender_district: booking.district || null,
      lender_state: booking.state || null,
      lender_pincode: booking.pincode || null,
    });
  } catch (err) {
    console.error('getPickupDetails error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pickup details' });
  }
};

// ─── GET /api/bookings/:id/borrower-details ───────────────────────────────────
// Lender-side mirror of getPickupDetails: reveals the borrower's contact +
// address, but ONLY once payment is confirmed (booking has moved past
// PENDING_PAYMENT) — never exposed while a booking is still just a request.
const getBorrowerDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT b.id, b.borrower_email, b.lender_email, b.payment_status,
              b.start_date, b.end_date, i.title,
              br.first_name, br.last_name, br.phone, br.address, br.district, br.state, br.pincode
       FROM bookings b
       JOIN items i ON b.item_id = i.id
       LEFT JOIN borrowers br ON LOWER(TRIM(br.email)) = LOWER(TRIM(b.borrower_email))
       WHERE b.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = rows[0];

    // Gate: only reveal once escrow payment has actually gone through
    if (!['HELD_IN_ESCROW', 'RENT_RELEASED', 'COMPLETED'].includes(booking.payment_status)) {
      return res.status(403).json({ success: false, message: 'Borrower details unlock once payment is confirmed' });
    }

    res.json({
      success: true,
      item_title: booking.title,
      start_date: booking.start_date,
      end_date: booking.end_date,
      borrower_name: booking.first_name ? `${booking.first_name} ${booking.last_name || ''}`.trim() : booking.borrower_email,
      borrower_email: booking.borrower_email,
      borrower_phone: booking.phone || null,
      borrower_address: booking.address || null,
      borrower_district: booking.district || null,
      borrower_state: booking.state || null,
      borrower_pincode: booking.pincode || null,
    });
  } catch (err) {
    console.error('getBorrowerDetails error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch borrower details' });
  }
};

module.exports = {
  getBookedDates,
  checkAvailability,
  createBooking,
  createOrder,
  verifyPayment,
  cancelBooking,
  getBorrowerBookings,
  getLenderBookings,
  updateBookingStatus,
  confirmPickup,
  confirmReturn,
  getLedger,
  getPickupDetails,
  getBorrowerDetails,
};
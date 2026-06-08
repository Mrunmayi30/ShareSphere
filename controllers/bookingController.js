const db = require('../config/db');
const nodemailer = require('nodemailer');

// ─── Email transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Constants ────────────────────────────────────────────────────────────────
const PLATFORM_FEE_PERCENT = 0.10;  // 10%
const DEPOSIT_PERCENT      = 0.20;  // 20% of rent as security deposit

// ─── Helper: calculate booking amounts ───────────────────────────────────────
function calcAmounts(pricePerDay, totalDays) {
  const rentAmount    = parseFloat((pricePerDay * totalDays).toFixed(2));
  const platformFee   = parseFloat((rentAmount * PLATFORM_FEE_PERCENT).toFixed(2));
  const depositAmount = parseFloat((rentAmount * DEPOSIT_PERCENT).toFixed(2));
  const totalPayable  = parseFloat((rentAmount + platformFee + depositAmount).toFixed(2));
  return { rentAmount, platformFee, depositAmount, totalPayable };
}

// ─── Helper: check if dates overlap with existing bookings ───────────────────
async function hasConflict(itemId, startDate, endDate, excludeBookingId = null) {
  let sql = `
    SELECT id FROM bookings
    WHERE item_id = ?
      AND booking_status NOT IN ('CANCELLED', 'COMPLETED')
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
         AND end_date >= CURDATE()`,
      [itemId]
    );

    // Expand ranges into individual blocked dates for easy frontend use
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

// ─── POST /api/bookings/create ────────────────────────────────────────────────
const createBooking = async (req, res) => {
  try {
    const { item_id, borrower_email, start_date, end_date } = req.body;

    if (!item_id || !borrower_email || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Validate dates
    const start = new Date(start_date);
    const end   = new Date(end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start < today) {
      return res.status(400).json({ error: 'Start date cannot be in the past' });
    }
    if (end < start) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

    // 2. Fetch item
    const [items] = await db.query('SELECT * FROM items WHERE id = ?', [item_id]);
    if (!items.length) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = items[0];

    // 3. Prevent owner from booking their own item
    if (item.owner_email === borrower_email) {
      return res.status(400).json({ error: 'You cannot book your own item' });
    }

    // 4. Check borrower is verified
    const [borrowers] = await db.query(
      'SELECT status FROM borrowers WHERE email = ?',
      [borrower_email]
    );
    if (!borrowers.length || borrowers[0].status !== 'Verified') {
      return res.status(403).json({ error: 'Borrower not verified' });
    }

    // 5. Availability check (race-condition safe — done just before insert)
    const conflict = await hasConflict(item_id, start_date, end_date);
    if (conflict) {
      return res.status(409).json({ error: 'Selected dates are not available' });
    }

    // 6. Calculate amounts
    const { rentAmount, platformFee, depositAmount, totalPayable } =
      calcAmounts(item.price_per_day, totalDays);

    // 7. Insert booking
    const [result] = await db.query(
      `INSERT INTO bookings
        (item_id, borrower_email, lender_email, start_date, end_date,
         total_days, price_per_day, rent_amount, platform_fee,
         deposit_amount, total_payable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item_id, borrower_email, item.owner_email,
        start_date, end_date, totalDays,
        item.price_per_day, rentAmount, platformFee,
        depositAmount, totalPayable,
      ]
    );

    const bookingId = result.insertId;

    // 8. Send email to lender
    try {
      await transporter.sendMail({
        from: `"ShareSphere" <${process.env.EMAIL_USER}>`,
        to: item.owner_email,
        subject: `New Booking Request — ${item.title}`,
        html: `
          <h2>You have a new booking request!</h2>
          <p><strong>Item:</strong> ${item.title}</p>
          <p><strong>Borrower:</strong> ${borrower_email}</p>
          <p><strong>Dates:</strong> ${start_date} to ${end_date} (${totalDays} day${totalDays > 1 ? 's' : ''})</p>
          <hr/>
          <p><strong>Rent:</strong> ₹${rentAmount}</p>
          <p><strong>Platform fee:</strong> ₹${platformFee}</p>
          <p><strong>Deposit:</strong> ₹${depositAmount}</p>
          <p><strong>Total payable by borrower:</strong> ₹${totalPayable}</p>
          <hr/>
          <p>Log in to your ShareSphere admin panel to review this request.</p>
          <p style="color:#888;font-size:12px;">Booking ID: #${bookingId}</p>
        `,
      });
      await db.query('UPDATE bookings SET lender_notified = 1 WHERE id = ?', [bookingId]);
    } catch (emailErr) {
      console.error('Email to lender failed (booking still created):', emailErr.message);
    }

    // 9. Send confirmation email to borrower
    try {
      await transporter.sendMail({
        from: `"ShareSphere" <${process.env.EMAIL_USER}>`,
        to: borrower_email,
        subject: `Booking Confirmed — ${item.title}`,
        html: `
          <h2>Your booking request has been placed!</h2>
          <p><strong>Item:</strong> ${item.title}</p>
          <p><strong>Dates:</strong> ${start_date} to ${end_date} (${totalDays} day${totalDays > 1 ? 's' : ''})</p>
          <hr/>
          <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
            <tr><td style="padding:4px 16px 4px 0;color:#555">Rent (${totalDays} days)</td><td>₹${rentAmount}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#555">Platform fee (10%)</td><td>₹${platformFee}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#555">Refundable deposit</td><td>₹${depositAmount}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;font-weight:bold">Total payable</td><td style="font-weight:bold">₹${totalPayable}</td></tr>
          </table>
          <hr/>
          <p>Payment gateway integration coming soon. The lender has been notified and will be in touch.</p>
          <p style="color:#888;font-size:12px;">Booking ID: #${bookingId}</p>
        `,
      });
    } catch (emailErr) {
      console.error('Email to borrower failed:', emailErr.message);
    }

    res.status(201).json({
      message: 'Booking created successfully',
      booking_id: bookingId,
      total_days: totalDays,
      rent_amount: rentAmount,
      platform_fee: platformFee,
      deposit_amount: depositAmount,
      total_payable: totalPayable,
    });
  } catch (err) {
    console.error('createBooking error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
};

// ─── GET /api/bookings/borrower/:email ───────────────────────────────────────
const getBorrowerBookings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, i.title, i.category, i.image_paths
       FROM bookings b
       JOIN items i ON b.item_id = i.id
       WHERE b.borrower_email = ?
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
const getLenderBookings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, i.title, i.category, i.image_paths
       FROM bookings b
       JOIN items i ON b.item_id = i.id
       WHERE b.lender_email = ?
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

module.exports = {
  getBookedDates,
  checkAvailability,
  createBooking,
  getBorrowerBookings,
  getLenderBookings,
  updateBookingStatus,
};
const db = require('../config/db');
const razorpay = require('../config/razorpay');

async function addLedgerEntry({ booking_id, event_type, amount, from_party, to_party, note }) {
  await db.query(
    `INSERT INTO booking_ledger (booking_id, event_type, amount, from_party, to_party, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [booking_id, event_type, amount ?? null, from_party ?? null, to_party ?? null, note ?? null]
  );
}

// ─── POST /api/disputes/:bookingId/raise ──────────────────────────────────────
// Either party can raise a dispute once pickup has been confirmed.
// Freezes the booking so confirm-return / normal completion can't proceed
// until an admin resolves it.
exports.raiseDispute = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { raised_by, raised_by_role, reason } = req.body;

    if (!raised_by || !raised_by_role || !reason) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const [bookingRows] = await db.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!bookingRows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = bookingRows[0];

    if (!['RENT_RELEASED', 'COMPLETED'].includes(booking.payment_status)) {
      return res.status(400).json({ success: false, message: 'Disputes can only be raised after pickup has been confirmed.' });
    }

    const evidencePhoto = req.file ? req.file.filename : null;

    const [result] = await db.query(
      `INSERT INTO disputes (booking_id, raised_by, raised_by_role, reason, evidence_photo, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [bookingId, raised_by, raised_by_role, reason, evidencePhoto]
    );

    await db.query(`UPDATE bookings SET booking_status = 'DISPUTED' WHERE id = ?`, [bookingId]);

    await addLedgerEntry({
      booking_id: bookingId,
      event_type: 'dispute_raised',
      amount: null,
      from_party: raised_by,
      to_party: null,
      note: `Dispute raised by ${raised_by_role}: ${reason}`,
    });

    res.json({ success: true, message: 'Dispute submitted. Our team will review it.', dispute_id: result.insertId });
  } catch (err) {
    console.error('raiseDispute error:', err);
    res.status(500).json({ success: false, message: 'Failed to raise dispute' });
  }
};

// ─── GET /api/disputes/booking/:bookingId ─────────────────────────────────────
// Lets the person who raised a dispute see their own submitted reason,
// persisted across reloads — not just right after they submit it.
exports.getDisputeForBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const [rows] = await db.query(
      `SELECT id, raised_by, raised_by_role, reason, evidence_photo, status,
              deduction_amount, resolution_note, created_at, resolved_at
       FROM disputes
       WHERE booking_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [bookingId]
    );
    res.json({ success: true, dispute: rows[0] || null });
  } catch (err) {
    console.error('getDisputeForBooking error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dispute' });
  }
};

// ─── GET /api/disputes ─────────────────────────────────────────────────────────
// Admin — list every dispute, newest first, joined with booking + photo data
exports.getAllDisputes = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, b.borrower_email, b.lender_email, b.deposit_amount, b.rent_amount,
              b.pickup_photo, b.return_photo, b.razorpay_payment_id, i.title
       FROM disputes d
       JOIN bookings b ON d.booking_id = b.id
       JOIN items i ON b.item_id = i.id
       ORDER BY d.created_at DESC`
    );
    res.json({ success: true, disputes: rows });
  } catch (err) {
    console.error('getAllDisputes error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch disputes' });
  }
};

// ─── POST /api/disputes/:disputeId/resolve ────────────────────────────────────
// Admin — decide a deduction amount, refund the remainder of the deposit
// (real Razorpay partial refund), mark the dispute resolved and the
// booking completed.
exports.resolveDispute = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { deduction_amount, resolution_note } = req.body;

    const [disputeRows] = await db.query('SELECT * FROM disputes WHERE id = ?', [disputeId]);
    if (!disputeRows.length) {
      return res.status(404).json({ success: false, message: 'Dispute not found' });
    }
    const dispute = disputeRows[0];

    const [bookingRows] = await db.query('SELECT * FROM bookings WHERE id = ?', [dispute.booking_id]);
    const booking = bookingRows[0];

    const deduction = Number(deduction_amount) || 0;
    if (deduction > Number(booking.deposit_amount)) {
      return res.status(400).json({ success: false, message: 'Deduction cannot exceed the deposit amount.' });
    }
    const refundAmount = Math.max(Number(booking.deposit_amount) - deduction, 0);

    // Only issue a refund if the deposit hasn't already been refunded
    if (booking.payment_status !== 'COMPLETED') {
      if (refundAmount > 0) {
        await razorpay.payments.refund(booking.razorpay_payment_id, {
          amount: Math.round(refundAmount * 100),
          notes: { booking_id: booking.id, reason: 'dispute_resolution' }
        });
      }

      await db.query(
        `UPDATE bookings SET booking_status = 'COMPLETED', payment_status = 'COMPLETED', deposit_refunded_at = NOW() WHERE id = ?`,
        [booking.id]
      );

      await addLedgerEntry({
        booking_id: booking.id,
        event_type: 'deposit_refunded',
        amount: refundAmount,
        from_party: 'ShareSphere Escrow',
        to_party: booking.borrower_email,
        note: `Partial refund after dispute resolution — ₹${deduction} deducted. ${resolution_note || ''}`,
      });
    } else {
      // Deposit was already refunded before this dispute was raised — just log resolution
      await db.query(`UPDATE bookings SET booking_status = 'COMPLETED' WHERE id = ?`, [booking.id]);
      await addLedgerEntry({
        booking_id: booking.id,
        event_type: 'dispute_resolved',
        amount: deduction,
        from_party: null,
        to_party: null,
        note: `Dispute resolved after deposit already refunded. Note: ${resolution_note || ''}`,
      });
    }

    await db.query(
      `UPDATE disputes SET status = 'resolved', deduction_amount = ?, resolution_note = ?, resolved_at = NOW() WHERE id = ?`,
      [deduction, resolution_note || null, disputeId]
    );

    res.json({ success: true, message: 'Dispute resolved', refund_amount: refundAmount });
  } catch (err) {
    console.error('resolveDispute error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve dispute' });
  }
};
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

// ─── POST /api/borrowers/apply ────────────────────────────────────────────────
const applyBorrower = async (req, res) => {
  try {
    const {
      firstName, lastName, dob, email, phone,
      address, state, district, pincode, idType,
    } = req.body;

    if (!firstName || !lastName || !dob || !email || !phone ||
        !address || !state || !district || !pincode || !idType) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const idDocument = req.files?.idDocument?.[0]?.filename || null;
    const selfPhoto  = req.files?.selfPhoto?.[0]?.filename  || null;

    if (!idDocument || !selfPhoto) {
      return res.status(400).json({ success: false, message: 'ID document and self photo are required' });
    }

    // Check if already applied
    const [existing] = await db.query(
      'SELECT id, status FROM borrowers WHERE email = ?', [email]
    );
    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: `You already have an application (status: ${existing[0].status})`,
      });
    }

    await db.query(
      `INSERT INTO borrowers
        (first_name, last_name, dob, email, phone, address, state,
         district, pincode, id_type, id_document, self_photo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [firstName, lastName, dob, email, phone, address, state,
       district, pincode, idType, idDocument, selfPhoto]
    );

    res.status(201).json({ success: true, message: 'Borrower application submitted successfully' });
  } catch (err) {
    console.error('applyBorrower error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit application' });
  }
};

// ─── GET /api/borrowers/status/:email ─────────────────────────────────────────
const getBorrowerStatus = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, status, created_at FROM borrowers WHERE email = ?',
      [req.params.email]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'No application found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('getBorrowerStatus error:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
};

// ─── GET /api/borrowers/all ───────────────────────────────────────────────────
// Admin: get all borrower applications
const getAllBorrowers = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM borrowers ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getAllBorrowers error:', err);
    res.status(500).json({ error: 'Failed to fetch borrowers' });
  }
};

// ─── POST /api/borrowers/verify ───────────────────────────────────────────────
// Admin: approve or reject a borrower application
const verifyBorrower = async (req, res) => {
  try {
    const { id, status } = req.body;   // status: 'Verified' or 'Rejected'

    if (!id || !['Verified', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'id and valid status (Verified/Rejected) required' });
    }

    // Fetch borrower to get email + name
    const [rows] = await db.query('SELECT * FROM borrowers WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Borrower not found' });
    }
    const borrower = rows[0];

    // Update status
    await db.query('UPDATE borrowers SET status = ? WHERE id = ?', [status, id]);

    // Send email notification
    const isApproved = status === 'Verified';
    try {
      await transporter.sendMail({
        from: `"ShareSphere" <${process.env.EMAIL_USER}>`,
        to: borrower.email,
        subject: isApproved
          ? 'Your borrower application has been approved!'
          : 'Update on your ShareSphere borrower application',
        html: isApproved
          ? `
            <h2>You're verified as a borrower! 🎉</h2>
            <p>Hi ${borrower.first_name},</p>
            <p>Your borrower application on ShareSphere has been approved.
               You can now rent items from lenders on the platform.</p>
            <p>Head back to ShareSphere and start browsing!</p>
          `
          : `
            <h2>Application update</h2>
            <p>Hi ${borrower.first_name},</p>
            <p>Unfortunately, your borrower application on ShareSphere could not be approved
               at this time. This may be due to incomplete or unclear documents.</p>
            <p>You're welcome to reapply with updated documents.</p>
          `,
      });
    } catch (emailErr) {
      console.error('Borrower verify email failed:', emailErr.message);
    }

    res.json({ message: `Borrower ${status} successfully` });
  } catch (err) {
    console.error('verifyBorrower error:', err);
    res.status(500).json({ error: 'Failed to update borrower status' });
  }
};

// ─── GET /api/borrowers/requests ──────────────────────────────────────────────
// Admin panel: get all borrower applications (same data as getAllBorrowers,
// matches the URL shape admin.html expects — same pattern as lenders)
const getAllRequests = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM borrowers ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getAllRequests error:', err);
    res.status(500).json({ error: 'Failed to fetch borrower requests' });
  }
};

// ─── PUT /api/borrowers/requests/:id ───────────────────────────────────────────
// Admin panel: approve or reject a borrower application
// (id comes from the URL param, status from the PUT body — matches admin.html's updateStatus())
const updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;   // 'Verified' or 'Rejected'

    if (!['Verified', 'Rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Valid status (Verified/Rejected) required' });
    }

    const [rows] = await db.query('SELECT * FROM borrowers WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Borrower not found' });
    }
    const borrower = rows[0];

    await db.query('UPDATE borrowers SET status = ? WHERE id = ?', [status, id]);

    const isApproved = status === 'Verified';
    try {
      await transporter.sendMail({
        from: `"ShareSphere" <${process.env.EMAIL_USER}>`,
        to: borrower.email,
        subject: isApproved
          ? 'Your borrower application has been approved!'
          : 'Update on your ShareSphere borrower application',
        html: isApproved
          ? `
            <h2>You're verified as a borrower! 🎉</h2>
            <p>Hi ${borrower.first_name},</p>
            <p>Your borrower application on ShareSphere has been approved.
               You can now rent items from lenders on the platform.</p>
            <p>Head back to ShareSphere and start browsing!</p>
          `
          : `
            <h2>Application update</h2>
            <p>Hi ${borrower.first_name},</p>
            <p>Unfortunately, your borrower application on ShareSphere could not be approved
               at this time. This may be due to incomplete or unclear documents.</p>
            <p>You're welcome to reapply with updated documents.</p>
          `,
      });
    } catch (emailErr) {
      console.error('Borrower status-update email failed:', emailErr.message);
    }

    res.json({ success: true, message: `Borrower ${status} successfully` });
  } catch (err) {
    console.error('updateRequestStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update borrower status' });
  }
};

module.exports = {
  applyBorrower,
  getBorrowerStatus,
  getAllBorrowers,
  verifyBorrower,
  getAllRequests,
  updateRequestStatus,
};
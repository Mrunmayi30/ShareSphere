const db = require('../config/db');

// Masks a bank account number down to its last 4 digits, e.g. "••••••1234".
// Never send the full account number back to the frontend — this profile
// page displays it to the account owner, but there's no reason for the raw
// number to ever leave the server once it's been saved.
function maskAccountNumber(num) {
  if (!num) return null;
  const str = String(num);
  if (str.length <= 4) return '••••';
  return '•'.repeat(str.length - 4) + str.slice(-4);
}

// ─── GET /api/profile/:email ───────────────────────────────────────────────────
// Merged profile: looks up this email in BOTH the borrowers table and the
// lender_requests table independently. A user can be one, the other, both,
// or neither (new signup with no KYC yet) — the frontend decides what to
// render based on which of these two keys come back non-null.
const getProfile = async (req, res) => {
  try {
    const email = req.params.email;

    const [borrowerRows] = await db.query(
      `SELECT id, first_name, last_name, dob, email, phone, address, state,
              district, pincode, id_type, id_document, self_photo, status, created_at
       FROM borrowers
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [email]
    );

    const [lenderRows] = await db.query(
      `SELECT id, first_name, last_name, dob, email, phone, address, state,
              district, pincode, id_type, id_document, self_photo, status,
              account_holder_name, bank_account_number, bank_ifsc, upi_id,
              bank_details_added
       FROM lender_requests
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [email]
    );

    const borrower = borrowerRows[0] || null;
    let lender = lenderRows[0] || null;

    // Mask the account number before it ever leaves the server
    if (lender) {
      lender = {
        ...lender,
        bank_account_number: maskAccountNumber(lender.bank_account_number),
      };
    }

    res.json({
      success: true,
      email,
      borrower,   // null if this email never applied as a borrower
      lender,     // null if this email never applied as a lender
    });
  } catch (err) {
    console.error('getProfile error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

module.exports = { getProfile };
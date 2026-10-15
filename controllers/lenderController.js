// controllers/lenderController.js
const db = require("../config/db");

// Apply to become lender
exports.applyLender = async (req, res) => {
    try {
        const {
            firstName, lastName, dob, email, phone, address, state, district, pincode, idType,
            accountHolderName, bankAccountNumber, bankIfsc, upiId
        } = req.body;
        const idDocFile = req.files?.idDocument ? req.files.idDocument[0].filename : null;
        const selfPhotoFile = req.files?.selfPhoto ? req.files.selfPhoto[0].filename : null;

        const sql = `
            INSERT INTO lender_requests
            (first_name, last_name, dob, email, phone, address, state, district, pincode, id_type, id_document, self_photo,
             account_holder_name, bank_account_number, bank_ifsc, upi_id, bank_details_added, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Pending')
        `;
        await db.execute(sql, [
            firstName, lastName, dob, email, phone, address, state, district, pincode, idType, idDocFile, selfPhotoFile,
            accountHolderName, bankAccountNumber || null, bankIfsc || null, upiId || null
        ]);
        res.json({ success: true, message: "Verification request submitted" });

    } catch (err) {
        console.error("applyLender error:", err);
        res.status(500).json({ success: false, message: "Submission failed" });
    }
};

// Check if a user has already applied
exports.checkLenderStatus = async (req, res) => {
    try {
        const { email } = req.params;
        const [results] = await db.execute(
            "SELECT * FROM lender_requests WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))",
            [email]
        );

        if (results.length > 0) {
            res.json({ applied: true, status: results[0].status });
        } else {
            res.json({ applied: false, status: null });
        }

    } catch (err) {
        console.error("checkLenderStatus error:", err);
        res.status(500).json({ success: false, message: "Database error" });
    }
};

// Get all lender requests (admin)
exports.getAllRequests = async (req, res) => {
    try {
        const [results] = await db.execute("SELECT * FROM lender_requests ORDER BY id DESC");
        res.json(results);

    } catch (err) {
        console.error("getAllRequests error:", err);
        res.status(500).json({ success: false, message: "Failed to fetch requests" });
    }
};

// Update status of a request (admin)
// This is called by the admin panel — status will be 'Verified' or 'Rejected'
exports.updateRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Normalise to exactly 'Verified' or 'Rejected' regardless of what admin panel sends
        const normalised = status.toLowerCase() === 'verified' ? 'Verified'
                         : status.toLowerCase() === 'rejected' ? 'Rejected'
                         : 'Pending';

        await db.execute(
            "UPDATE lender_requests SET status = ? WHERE id = ?",
            [normalised, id]
        );

        res.json({ success: true, message: `Request ${normalised}` });

    } catch (err) {
        console.error("updateRequestStatus error:", err);
        res.status(500).json({ success: false, message: "Failed to update status" });
    }
};

// Save lender's payout details
exports.saveBankDetails = async (req, res) => {
    try {
        const { email, account_holder_name, bank_account_number, bank_ifsc, upi_id } = req.body;

        if (!email || !account_holder_name || (!bank_account_number && !upi_id)) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        await db.execute(
            `UPDATE lender_requests
             SET account_holder_name = ?, bank_account_number = ?, bank_ifsc = ?, upi_id = ?, bank_details_added = 1
             WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
            [account_holder_name, bank_account_number || null, bank_ifsc || null, upi_id || null, email]
        );

        res.json({ success: true, message: "Bank details saved" });

    } catch (err) {
        console.error("saveBankDetails error:", err);
        res.status(500).json({ success: false, message: "Could not save bank details" });
    }
};

// Fetch lender's payout details
exports.getBankDetails = async (req, res) => {
    try {
        const { email } = req.params;
        const [rows] = await db.execute(
            `SELECT account_holder_name, bank_account_number, bank_ifsc, upi_id, bank_details_added
             FROM lender_requests WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
            [email]
        );
        res.json(rows[0] || { bank_details_added: 0 });

    } catch (err) {
        console.error("getBankDetails error:", err);
        res.status(500).json({ success: false, message: "Failed to fetch bank details" });
    }
};
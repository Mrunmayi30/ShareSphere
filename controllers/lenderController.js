// controllers/lenderController.js
const db = require("../config/db");

// Apply to become lender
exports.applyLender = async (req, res) => {
    try {
        const { firstName, lastName, dob, email, phone, address, state, district, pincode, idType } = req.body;
        const idDocFile = req.files?.idDocument ? req.files.idDocument[0].filename : null;
        const selfPhotoFile = req.files?.selfPhoto ? req.files.selfPhoto[0].filename : null;

        const sql = `
            INSERT INTO lender_requests
            (first_name, last_name, dob, email, phone, address, state, district, pincode, id_type, id_document, self_photo, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
        `;
        await db.execute(sql, [firstName, lastName, dob, email, phone, address, state, district, pincode, idType, idDocFile, selfPhotoFile]);
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
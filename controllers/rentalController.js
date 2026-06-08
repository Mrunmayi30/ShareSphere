const db = require("../config/db");

// Borrow Item
exports.borrowItem = (req, res) => {
    const { item_id, borrower_id, rental_period } = req.body;

    const sql = `
        INSERT INTO rentals (item_id, borrower_id, rental_period)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [item_id, borrower_id, rental_period], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err });
        }

        res.json({
            message: "Item borrowed successfully",
            rental_id: result.insertId
        });
    });
};


// Get All Rentals
exports.getRentals = (req, res) => {

    const sql = "SELECT * FROM rentals";

    db.query(sql, (err, result) => {

        if (err) {
            return res.status(500).json({ error: err });
        }

        res.json(result);
    });
};


// Return Item
exports.returnItem = (req, res) => {

    const { id } = req.params;

    const sql = `
        UPDATE rentals
        SET status = 'returned'
        WHERE id = ?
    `;

    db.query(sql, [id], (err, result) => {

        if (err) {
            return res.status(500).json({ error: err });
        }

        res.json({
            message: "Item returned successfully"
        });
    });
};
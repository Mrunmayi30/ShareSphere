const express = require("express");
const router = express.Router();
const db = require("../config/db");

/**
 * POST /api/reviews
 * Borrower rates & reviews the lender for a completed booking.
 * One review per booking, and only the actual borrower on that booking may submit it.
 */
router.post("/", async (req, res) => {
  const { booking_id, reviewer_email, rating, comment } = req.body;

  if (!booking_id || !reviewer_email || !rating || rating < 1 || rating > 5) {
    return res.json({ success: false, message: "Missing or invalid fields." });
  }

  try {
    const [rows] = await db.execute(
      `SELECT borrower_email, lender_email, payment_status FROM bookings WHERE id = ?`,
      [booking_id]
    );
    const booking = rows[0];

    if (!booking) {
      return res.json({ success: false, message: "Booking not found." });
    }
    if (booking.payment_status !== "COMPLETED") {
      return res.json({ success: false, message: "You can only review after the item has been returned." });
    }
    if (reviewer_email !== booking.borrower_email) {
      return res.json({ success: false, message: "Only the borrower on this booking can leave this review." });
    }

    await db.execute(
      `INSERT INTO reviews (booking_id, reviewer_email, reviewee_email, rating, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [booking_id, reviewer_email, booking.lender_email, rating, comment || null]
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.json({ success: false, message: "You already reviewed this booking." });
    }
    console.error("POST /api/reviews failed:", err);
    res.json({ success: false, message: "Could not submit review." });
  }
});

/**
 * GET /api/reviews/booking/:bookingId
 * Used by bookings.html to check whether this booking already has a review,
 * so it can show the read-only review-box instead of the rating form.
 */
router.get("/booking/:bookingId", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT rating, comment, created_at FROM reviews WHERE booking_id = ? LIMIT 1`,
      [req.params.bookingId]
    );
    res.json({ success: true, review: rows[0] || null });
  } catch (err) {
    console.error("GET /api/reviews/booking/:bookingId failed:", err);
    res.json({ success: false });
  }
});

/**
 * GET /api/reviews/user/:email
 * Used by item-detail.html to show a lender's average rating + review count.
 */
router.get("/user/:email", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT AVG(rating) AS avg_rating, COUNT(*) AS review_count
       FROM reviews WHERE reviewee_email = ?`,
      [req.params.email]
    );
    const stats = rows[0];
    res.json({
      success: true,
      avg_rating: stats.avg_rating ? Number(stats.avg_rating).toFixed(1) : null,
      review_count: stats.review_count
    });
  } catch (err) {
    console.error("GET /api/reviews/user/:email failed:", err);
    res.json({ success: false });
  }
});

/**
 * GET /api/reviews/users/batch?emails=a@x.com,b@y.com
 * Returns average rating + review count for several lenders in one call.
 * Used by category.html so a whole grid of item cards can show ratings
 * without firing one request per card.
 */
router.get("/users/batch", async (req, res) => {
  const emails = (req.query.emails || "")
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);

  if (!emails.length) {
    return res.json({ success: true, ratings: {} });
  }

  try {
    const placeholders = emails.map(() => "?").join(",");
    const [rows] = await db.execute(
      `SELECT reviewee_email, AVG(rating) AS avg_rating, COUNT(*) AS review_count
       FROM reviews
       WHERE reviewee_email IN (${placeholders})
       GROUP BY reviewee_email`,
      emails
    );

    const ratings = {};
    rows.forEach(r => {
      ratings[r.reviewee_email] = {
        avg_rating: Number(r.avg_rating).toFixed(1),
        review_count: r.review_count
      };
    });

    res.json({ success: true, ratings });
  } catch (err) {
    console.error("GET /api/reviews/users/batch failed:", err);
    res.json({ success: false });
  }
});

/**
 * GET /api/reviews/user/:email/list
 * Returns individual reviews for a lender (newest first), for the full
 * "Ratings & Reviews" list shown at the bottom of item-detail.html.
 * reviewer_email is included so the frontend can mask it for privacy.
 */
router.get("/user/:email/list", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT rating, comment, created_at, reviewer_email
       FROM reviews
       WHERE reviewee_email = ?
       ORDER BY created_at DESC`,
      [req.params.email]
    );
    res.json({ success: true, reviews: rows });
  } catch (err) {
    console.error("GET /api/reviews/user/:email/list failed:", err);
    res.json({ success: false });
  }
});

module.exports = router;
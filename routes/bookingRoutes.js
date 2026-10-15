const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const {
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
} = require('../controllers/bookingController');

// ── Multer setup for pickup/return photo uploads ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Availability
router.get('/booked-dates/:itemId',   getBookedDates);
router.post('/check-availability',    checkAvailability);

// Create + payment flow (matches item-details.html fetch calls exactly)
router.post('/',                      createBooking);
router.post('/:id/create-order',      createOrder);
router.post('/:id/verify-payment',    verifyPayment);
router.post('/:id/cancel',            cancelBooking);

// User views
router.get('/borrower/:email',        getBorrowerBookings);
router.get('/lender/:email',          getLenderBookings);

// Escrow lifecycle (now require a photo upload alongside the OTP)
router.post('/:id/confirm-pickup',    upload.single('photo'), confirmPickup);
router.post('/:id/confirm-return',    upload.single('photo'), confirmReturn);
router.get('/:id/ledger',             getLedger);
router.get('/:id/pickup-details',     getPickupDetails);
router.get('/:id/borrower-details',   getBorrowerDetails);

// Admin / system
router.put('/:id/status',             updateBookingStatus);

module.exports = router;
const express = require('express');
const router  = express.Router();
const {
  getBookedDates,
  checkAvailability,
  createBooking,
  getBorrowerBookings,
  getLenderBookings,
  updateBookingStatus,
} = require('../controllers/bookingController');

// Availability
router.get('/booked-dates/:itemId',   getBookedDates);
router.post('/check-availability',    checkAvailability);

// Create
router.post('/create',                createBooking);

// User views
router.get('/borrower/:email',        getBorrowerBookings);
router.get('/lender/:email',          getLenderBookings);

// Admin / system
router.put('/:id/status',             updateBookingStatus);

module.exports = router;
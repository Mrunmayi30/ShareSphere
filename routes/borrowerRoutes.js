const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const borrowerController = require('../controllers/borrowerController');

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Routes
router.post('/apply', upload.fields([
  { name: 'idDocument', maxCount: 1 },
  { name: 'selfPhoto',  maxCount: 1 }
]), borrowerController.applyBorrower);

router.get('/status/:email', borrowerController.getBorrowerStatus);
router.get('/all',           borrowerController.getAllBorrowers);
router.post('/verify',       borrowerController.verifyBorrower);

// NOTE: /rent-request removed — Rent Now flow now goes through /api/bookings/create

module.exports = router;
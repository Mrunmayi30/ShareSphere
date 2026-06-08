const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Email OTP routes
router.post('/send-otp', authController.sendEmailOTP);
router.post('/verify-otp', authController.verifyEmailOTP);

// Optional: keep register/login
router.post('/register', authController.register);
router.post('/login', authController.login);

// GET USER DATA (for autofill in lender form)
router.get('/user', authController.getUser);

module.exports = router;
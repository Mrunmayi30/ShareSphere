// controllers/authController.js
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const db = require("../config/db");

// TEMP OTP store
let otpStore = {};

// --- Send Email OTP ---
exports.sendEmailOTP = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: "Email required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[email] = otp;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your ShareSphere OTP",
      text: `Your OTP is ${otp}`,
    });
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.log("EMAIL ERROR:", err);
    res.json({ success: false, message: "Error sending OTP" });
  }
};

// --- Verify Email OTP ---
exports.verifyEmailOTP = (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp)
    return res.json({ success: false, message: "Email and OTP required" });

  if (otpStore[email] === otp) {
    delete otpStore[email];
    res.json({ success: true, message: "OTP verified successfully" });
  } else {
    res.json({ success: false, message: "Invalid OTP" });
  }
};

// --- Register User ---
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, dob, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (first_name, last_name, dob, email, password) VALUES (?, ?, ?, ?, ?)",
      [firstName, lastName, dob, email, hashedPassword]
    );

    res.json({ success: true, message: "User registered successfully" });

  } catch (err) {
    console.error("REGISTER ERROR:", err.code, err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: "Email already registered. Please log in." });
    }
    res.json({ success: false, message: err.message });
  }
};

// --- Login User (CLEAN SINGLE FUNCTION) ---
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ success: false, message: "Email and password required" });

  try {
    const [results] = await db.query(
      "SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))",
      [email]
    );

    if (results.length === 0)
      return res.status(400).json({ success: false, message: "User not found" });

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match)
      return res.status(400).json({ success: false, message: "Incorrect password" });

    res.json({
      success: true,
      message: "Login successful",
      user: { first_name: user.first_name, last_name: user.last_name, dob: user.dob },
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// --- Get User for Lender Form ---
exports.getUser = async (req, res) => {
  console.log("getUser called, email:", req.query.email);
  const email = req.query.email;
  if (!email) return res.json({});

  try {
    const [results] = await db.query(
      "SELECT first_name, last_name, dob FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))",
      [email]
    );
    if (results.length === 0) return res.json({});
    res.json(results[0]);
  } catch (err) {
    console.error("getUser error:", err.message);
    res.json({});
  }
};
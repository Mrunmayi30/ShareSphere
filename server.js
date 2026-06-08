require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./config/db");

// Import routes
const authRoutes     = require("./routes/authRoutes");
const itemRoutes     = require("./routes/itemRoutes");
const lenderRoutes   = require("./routes/lenderRoutes");
const borrowerRoutes = require("./routes/borrowerRoutes");
const bookingRoutes  = require("./routes/rentalRoutes");   // ← single import, clear name

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// API routes
app.use("/api/auth",      authRoutes);
app.use("/api/items",     itemRoutes);
app.use("/api/lenders",   lenderRoutes);
app.use("/api/borrowers", borrowerRoutes);
app.use("/api/bookings",  bookingRoutes);   // ← single mount at /api/bookings

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
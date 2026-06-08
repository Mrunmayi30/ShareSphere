const express = require("express");
const router = express.Router();
const path = require("path"); // needed for sendFile
const multer = require("multer");
const lenderController = require("../controllers/lenderController");

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// Apply to become lender (handles files)
router.post("/apply", upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "selfPhoto", maxCount: 1 }
]), lenderController.applyLender);

// **Admin fetch all requests**
router.get("/requests", lenderController.getAllRequests);

// **Admin update request status**
router.put("/requests/:id", lenderController.updateRequestStatus);

// **Check lender status for logged-in user**
router.get("/status/:email", lenderController.checkLenderStatus);


module.exports = router;
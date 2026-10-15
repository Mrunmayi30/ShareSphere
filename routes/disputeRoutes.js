const express = require('express');
const router = express.Router();
const multer = require('multer');
const disputeController = require('../controllers/disputeController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

router.post('/:bookingId/raise', upload.single('evidence'), disputeController.raiseDispute);
router.get('/booking/:bookingId', disputeController.getDisputeForBooking);
router.get('/', disputeController.getAllDisputes);
router.post('/:disputeId/resolve', disputeController.resolveDispute);

module.exports = router;
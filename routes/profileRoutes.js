const express = require('express');
const router = express.Router();
const { getProfile } = require('../controllers/profileController');

router.get('/:email', getProfile);

module.exports = router;
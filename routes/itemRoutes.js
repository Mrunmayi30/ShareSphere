// routes/itemRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const itemController = require('../controllers/itemController');

// ── Multer config ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});


const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per file
});

const uploadFields = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'video',  maxCount: 1  },
{ name: 'invoice', maxCount: 1  },
]);

// ── Routes ────────────────────────────────────────────────────────────────────

// GET  /api/items/categories   — must be BEFORE /:id to avoid conflict
router.get('/categories', itemController.getCategories);

// GET  /api/items              — list all, filter by ?category=
router.get('/', itemController.getItems);

// GET  /api/items/:id          — single item
router.get('/:id', itemController.getItemById);

// POST /api/items/create       — create new listing
router.post('/create', uploadFields, itemController.createItem);

// DELETE /api/items/:id
router.delete('/:id', itemController.deleteItem);

module.exports = router;
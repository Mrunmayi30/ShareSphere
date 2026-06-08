// controllers/itemController.js
const db = require('../config/db');
const path = require('path');

exports.createItem = async (req, res) => {
  try {
    const {
      title, category, description, condition, rules, item_location,
      // price — accept either field name from the form
      price_per_day, price_per_month,
      // extra fields from the listing form
      brand, model_number, serial_number, item_age,
      purchase_price, deposit,
      min_duration, max_duration,
      pickup_method, delivery_charges, delivery_radius,
      maintenance, warranty_status, warranty_expiry, insurance,
    } = req.body;

    const owner_email = req.user?.email || req.body.owner_email;

    // Accept price from either field name
    const finalPrice = price_per_month || price_per_day;

    if (!title || !category || !description || !finalPrice || !condition) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const imagePaths = req.files?.images
      ? req.files.images.map(f => 'uploads/' + f.filename)
      : [];

    const videoPath = req.files?.video
      ? 'uploads/' + req.files.video[0].filename
      : null;

    const [result] = await db.execute(
      `INSERT INTO items (
        title, category, description,
        price_per_day, price_per_month,
        \`condition\`, rules,
        image_paths, video_path,
        owner_email, item_location,
        brand, model_number, serial_number, item_age,
        purchase_price, deposit,
        min_duration, max_duration,
        pickup_method, delivery_charges, delivery_radius,
        maintenance, warranty_status, warranty_expiry, insurance,
        created_at
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?,
        '[]', ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        NOW()
      )`,
      [
        title, category, description,
        finalPrice, finalPrice,           // store in both columns for compatibility
        condition, rules || null,
        videoPath,
        owner_email, item_location || null,
        brand || null, model_number || null, serial_number || null, item_age || null,
        purchase_price || null, deposit || null,
        min_duration || null, max_duration || null,
        pickup_method || null, delivery_charges || null, delivery_radius || null,
        maintenance || null, warranty_status || null, warranty_expiry || null, insurance || null,
      ]
    );

    if (imagePaths.length > 0) {
      await db.query(
        'UPDATE items SET image_paths = ? WHERE id = ?',
        [JSON.stringify(imagePaths), result.insertId]
      );
    }

    return res.status(201).json({
      success: true,
      item_id: result.insertId,
      message: 'Item listed successfully',
    });

  } catch (err) {
    console.error('createItem error:', err);
    return res.status(500).json({ error: 'Failed to create listing' });
  }
};

exports.getItems = async (req, res) => {
  try {
    const category = req.query.category;

    let query;
    let params;

    if (category) {
      query = 'SELECT * FROM items WHERE category = ? ORDER BY created_at DESC';
      params = [category];
    } else {
      query = 'SELECT * FROM items ORDER BY created_at DESC';
      params = [];
    }

    const [rows] = await db.execute(query, params);

    const items = rows.map(item => ({
      ...item,
      image_paths: safeJsonParse(item.image_paths, []),
    }));

    return res.json({ items, total: items.length });

  } catch (err) {
    console.error('getItems error:', err);
    return res.status(500).json({ error: 'Failed to fetch items' });
  }
};

exports.getItemById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT
         i.*,
         CONCAT(lr.first_name, ' ', lr.last_name) AS lender_name,
         lr.phone                                  AS lender_phone,
         lr.email                                  AS lender_email
       FROM items i
       LEFT JOIN lender_requests lr
         ON LOWER(TRIM(lr.email)) = LOWER(TRIM(i.owner_email))
        AND lr.status = 'Verified'
       WHERE i.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = {
      ...rows[0],
      image_paths: safeJsonParse(rows[0].image_paths, []),
    };

    return res.json(item);

  } catch (err) {
    console.error('getItemById error:', err);
    return res.status(500).json({ error: 'Failed to fetch item' });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT DISTINCT category, COUNT(*) as count FROM items GROUP BY category ORDER BY count DESC'
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('getCategories error:', err);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const requester_email = req.user?.email;

    const [rows] = await db.execute('SELECT owner_email FROM items WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });

    if (rows[0].owner_email !== requester_email && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.execute('DELETE FROM items WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('deleteItem error:', err);
    return res.status(500).json({ error: 'Failed to delete item' });
  }
};

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  if (Array.isArray(str)) return str;
  try { return JSON.parse(str); }
  catch { return fallback; }
}
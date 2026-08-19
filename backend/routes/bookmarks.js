const router = require('express').Router();
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, requireRole('student'), async (req, res) => {
    try {
        const [bookmarks] = await db.query(`
            SELECT bm.bookmark_id, bm.created_at, bk.book_id, bk.title, bk.resource_type, bk.cover_image,
                   c.name AS category_name,
                   (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE book_id = bk.book_id) AS avg_rating
            FROM bookmarks bm
            JOIN books bk ON bm.book_id = bk.book_id
            LEFT JOIN categories c ON c.category_id = bk.category_id
            WHERE bm.user_id = ?
            ORDER BY bm.created_at DESC
        `, [req.user.user_id]);
        res.json(bookmarks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, requireRole('student'), async (req, res) => {
    try {
        const { book_id } = req.body;
        const [rows] = await db.query('SELECT bookmark_id FROM bookmarks WHERE user_id = ? AND book_id = ?', [req.user.user_id, book_id]);
        const existing = rows[0];
        
        if (existing) {
            await db.query('DELETE FROM bookmarks WHERE bookmark_id = ?', [existing.bookmark_id]);
            res.json({ bookmarked: false });
        } else {
            await db.query('INSERT INTO bookmarks (user_id, book_id) VALUES (?, ?)', [req.user.user_id, book_id]);
            res.json({ bookmarked: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

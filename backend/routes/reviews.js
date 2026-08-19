const router = require('express').Router();
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/:bookId', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT r.review_id, r.rating, r.comment, r.created_at, u.first_name, u.last_name
            FROM reviews r JOIN users u ON u.user_id = r.user_id
            WHERE r.book_id = ?
            ORDER BY r.created_at DESC
        `, [req.params.bookId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, requireRole('student'), async (req, res) => {
    try {
        const { book_id, rating, comment } = req.body;
        if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Invalid rating' });

        const [existingRows] = await db.query('SELECT review_id FROM reviews WHERE user_id = ? AND book_id = ?', [req.user.user_id, book_id]);
        if (existingRows[0]) {
            await db.query('UPDATE reviews SET rating = ?, comment = ? WHERE review_id = ?', [rating, comment, existingRows[0].review_id]);
        } else {
            await db.query('INSERT INTO reviews (user_id, book_id, rating, comment) VALUES (?, ?, ?, ?)', [req.user.user_id, book_id, rating, comment]);
        }

        res.json({ message: 'Review saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;

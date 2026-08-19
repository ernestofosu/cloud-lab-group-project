const router = require('express').Router();
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { clean } = require('../utils/helpers');

const VALID_AUDIENCES = ['all', 'student', 'lecturer'];

router.get('/', authenticate, async (req, res) => {
    try {
        if (req.query.all === '1' && req.user.role_name === 'admin') {
            const [anns] = await db.query(`
                SELECT a.*, u.first_name, u.last_name
                FROM announcements a LEFT JOIN users u ON u.user_id = a.created_by
                ORDER BY a.created_at DESC
            `);
            return res.json(anns);
        }
        const [anns] = await db.query(`
            SELECT a.*, u.first_name, u.last_name
            FROM announcements a LEFT JOIN users u ON u.user_id = a.created_by
            WHERE a.audience = ? OR a.audience = 'all'
            ORDER BY a.created_at DESC
        `, [req.user.role_name]);
        res.json(anns);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const title = clean(req.body.title);
        // The admin form posts `body`/`audience`; `content`/`target_role` are
        // accepted as aliases for any older callers.
        const body = clean(req.body.body || req.body.content);
        const audience = clean(req.body.audience || req.body.target_role) || 'all';

        if (!title || !body) {
            return res.status(400).json({ error: 'Title and message are required.' });
        }
        if (!VALID_AUDIENCES.includes(audience)) {
            return res.status(400).json({ error: `Audience must be one of: ${VALID_AUDIENCES.join(', ')}.` });
        }

        const [result] = await db.query(
            'INSERT INTO announcements (title, body, audience, created_by) VALUES (?, ?, ?, ?)',
            [title, body, audience, req.user.user_id]
        );

        // Fan the announcement out into recipients' notification feeds.
        const [users] = await db.query(
            `SELECT u.user_id
             FROM users u JOIN roles r ON r.role_id = u.role_id
             WHERE u.status = 'active' AND (? = 'all' OR r.role_name = ?)`,
            [audience, audience]
        );

        if (users.length) {
            await db.query(
                'INSERT INTO notifications (user_id, title, message) VALUES ?',
                [users.map((u) => [u.user_id, 'New Announcement: ' + title, body])]
            );
        }

        res.status(201).json({ announcement_id: result.insertId, id: result.insertId, notified: users.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM announcements WHERE announcement_id = ?', [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Announcement not found.' });
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

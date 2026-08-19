const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { storageDelete } = require('../utils/storage');
const { logActivity } = require('../utils/helpers');

const BOOK_STATUSES = ['pending', 'approved', 'rejected'];

router.get('/books', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { q, status, type } = req.query;
        const conditions = [];
        const params = [];

        if (q) {
            conditions.push('(b.title LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
            params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (status) {
            conditions.push('b.status = ?');
            params.push(status);
        }
        if (type) {
            conditions.push('b.resource_type = ?');
            params.push(type);
        }

        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const [rows] = await db.query(`
            SELECT b.book_id, b.title, b.description, b.resource_type, b.status,
                   b.file_path, b.cover_image, b.created_at,
                   c.name AS category_name,
                   u.first_name AS uploader_first_name, u.last_name AS uploader_last_name, u.email AS uploader_email
            FROM books b
            LEFT JOIN categories c ON c.category_id = b.category_id
            LEFT JOIN users u ON u.user_id = b.uploaded_by
            ${whereClause}
            ORDER BY b.created_at DESC
        `, params);

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/users', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { q, role, status } = req.query;
        const conditions = [];
        const params = [];
        if (q) {
            conditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.institution_id LIKE ?)');
            params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (role) { conditions.push('r.role_name = ?'); params.push(role); }
        if (status) { conditions.push('u.status = ?'); params.push(status); }
        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const [users] = await db.query(`
            SELECT u.user_id, u.first_name, u.last_name, u.email, u.institution_id, u.department, u.status, u.created_at, r.role_name
            FROM users u JOIN roles r ON r.role_id = u.role_id
            ${whereClause}
            ORDER BY u.created_at DESC
        `, params);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/users/:id/status', authenticate, requireRole('admin'), async (req, res) => {
    try {
        if (req.user.user_id == req.params.id) return res.status(400).json({ error: 'Cannot change own status' });
        await db.query('UPDATE users SET status = ? WHERE user_id = ?', [req.body.status, req.params.id]);
        res.json({ message: 'Status updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        if (Number(req.params.id) === req.user.user_id) {
            return res.status(400).json({ error: 'You cannot delete your own account.' });
        }

        const [rows] = await db.query('SELECT COUNT(*) AS count FROM books WHERE uploaded_by = ?', [req.params.id]);
        if (rows[0].count > 0) {
            return res.status(400).json({
                error: `This user has ${rows[0].count} uploaded resource(s). Remove or reassign them first.`,
            });
        }

        const [result] = await db.query('DELETE FROM users WHERE user_id = ?', [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'User not found.' });

        await logActivity(req.user.user_id, 'user_deleted', `Admin deleted user #${req.params.id}`, req.ip);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/users/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT user_id, email FROM users WHERE user_id = ?', [req.params.id]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'User not found.' });

        // No email transport is configured, so issue a temporary password and
        // return it to the admin to pass on out of band.
        const temporaryPassword = crypto.randomBytes(9).toString('base64url') + 'A1!';
        const hash = bcrypt.hashSync(temporaryPassword, 10);

        await db.query(
            'UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE user_id = ?',
            [hash, user.user_id]
        );

        await logActivity(
            req.user.user_id,
            'password_reset',
            `Admin reset the password for ${user.email}`,
            req.ip
        );

        res.json({
            message: 'Password reset. Share the temporary password with the user.',
            email: user.email,
            temporary_password: temporaryPassword,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/books/:id/status', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { status, rejection_reason } = req.body;
        if (!BOOK_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${BOOK_STATUSES.join(', ')}.` });
        }

        const [rows] = await db.query('SELECT book_id, title, uploaded_by FROM books WHERE book_id = ?', [req.params.id]);
        const book = rows[0];
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        await db.query(
            'UPDATE books SET status = ?, rejection_reason = ? WHERE book_id = ?',
            [status, status === 'rejected' ? (rejection_reason || null) : null, book.book_id]
        );

        // Tell the uploader what happened to their submission.
        const message = status === 'approved'
            ? `Your resource "${book.title}" has been approved and is now in the library.`
            : status === 'rejected'
                ? `Your resource "${book.title}" was not approved.${rejection_reason ? ' Reason: ' + rejection_reason : ''}`
                : `Your resource "${book.title}" is awaiting review.`;

        await db.query(
            'INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)',
            [book.uploaded_by, 'Resource ' + status, message, `book-details.html?id=${book.book_id}`]
        );

        await logActivity(
            req.user.user_id,
            'book_status_changed',
            `Admin set resource "${book.title}" to ${status}`,
            req.ip
        );

        res.json({ message: 'Book status updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/books/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT book_id, title, file_path, cover_image FROM books WHERE book_id = ?',
            [req.params.id]
        );
        const book = rows[0];
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        // Drop the row first — if that fails, the files are still referenced.
        await db.query('DELETE FROM books WHERE book_id = ?', [book.book_id]);

        await storageDelete(book.file_path);
        if (book.cover_image) await storageDelete(book.cover_image);

        await logActivity(req.user.user_id, 'book_deleted', `Admin deleted resource "${book.title}"`, req.ip);
        res.json({ message: 'Book deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/logs', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { q, action } = req.query;
        const conditions = [];
        const params = [];
        if (q) {
            conditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR l.description LIKE ?)');
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (action) { conditions.push('l.action = ?'); params.push(action); }
        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const [logs] = await db.query(`
            SELECT l.*, u.first_name, u.last_name
            FROM activity_logs l LEFT JOIN users u ON u.user_id = l.user_id
            ${whereClause}
            ORDER BY l.created_at DESC LIMIT 100
        `, params);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/messages', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { status } = req.query;
        let whereClause = '';
        if (status === 'unread') whereClause = 'WHERE is_resolved = 0';
        else if (status === 'resolved') whereClause = 'WHERE is_resolved = 1';
        const [msgs] = await db.query(`SELECT * FROM contact_messages ${whereClause} ORDER BY created_at DESC`);
        res.json(msgs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/messages/:id/resolve', authenticate, requireRole('admin'), async (req, res) => {
    try {
        await db.query('UPDATE contact_messages SET is_resolved = 1 WHERE message_id = ?', [req.params.id]);
        res.json({ message: 'Resolved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/messages/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        await db.query('DELETE FROM contact_messages WHERE message_id = ?', [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

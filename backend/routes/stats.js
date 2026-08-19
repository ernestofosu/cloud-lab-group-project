const router = require('express').Router();
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { monthlyTrend } = require('../utils/helpers');
const { storageReadUrl } = require('../utils/storage');

const monthGroupSql = (column) => `DATE_FORMAT(${column}, '%Y-%m') as ym`;
const monthWindowSql = (column) =>
    `${column} >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 5 MONTH)`;
const currentMonthStartSql = (column) => `${column} >= DATE_FORMAT(NOW(), '%Y-%m-01')`;

router.get('/', async (req, res) => {
    try {
        const [booksRows] = await db.query("SELECT COUNT(*) as count FROM books WHERE status = 'approved'");
        const [studentsRows] = await db.query("SELECT COUNT(*) as count FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'student'");
        const [lecturersRows] = await db.query("SELECT COUNT(*) as count FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'lecturer'");
        const [downloadsRows] = await db.query('SELECT SUM(downloads_count) as count FROM books');
        
        res.json({ 
            books: booksRows[0].count, 
            students: studentsRows[0].count, 
            lecturers: lecturersRows[0].count, 
            downloads: downloadsRows[0].count || 0 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/admin', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const [studentsRows] = await db.query("SELECT COUNT(*) as count FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'student'");
        const [lecturersRows] = await db.query("SELECT COUNT(*) as count FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'lecturer'");
        const [pendingRows] = await db.query("SELECT COUNT(*) as count FROM books WHERE status = 'pending'");
        const [approvedRows] = await db.query("SELECT COUNT(*) as count FROM books WHERE status = 'approved'");
        const [rejectedRows] = await db.query("SELECT COUNT(*) as count FROM books WHERE status = 'rejected'");
        const [totalBooksRows] = await db.query('SELECT COUNT(*) as count FROM books');
        const [downloadsRows] = await db.query('SELECT SUM(downloads_count) as count FROM books');
        const [signupsRows] = await db.query(`SELECT COUNT(*) as count FROM users WHERE ${currentMonthStartSql('created_at')}`);
        const [suspendedRows] = await db.query("SELECT COUNT(*) as count FROM users WHERE status = 'suspended'");
        const [unreadRows] = await db.query('SELECT COUNT(*) as count FROM contact_messages WHERE is_resolved = 0');
        const [reviewsRows] = await db.query('SELECT COUNT(*) as count FROM reviews');

        const [userTrendRows] = await db.query(`
            SELECT ${monthGroupSql('created_at')}, COUNT(*) as count
            FROM users WHERE ${monthWindowSql('created_at')}
            GROUP BY ym ORDER BY ym ASC
        `);
        const [uploadTrendRows] = await db.query(`
            SELECT ${monthGroupSql('created_at')}, COUNT(*) as count
            FROM books WHERE ${monthWindowSql('created_at')}
            GROUP BY ym ORDER BY ym ASC
        `);
        const [categoryRows] = await db.query(`
            SELECT c.name, COUNT(b.book_id) as count
            FROM categories c LEFT JOIN books b ON b.category_id = c.category_id AND b.status = 'approved'
            GROUP BY c.category_id, c.name ORDER BY count DESC LIMIT 6
        `);
        const [activityRows] = await db.query(`
            SELECT l.action, l.description, l.created_at, u.first_name, u.last_name
            FROM activity_logs l LEFT JOIN users u ON u.user_id = l.user_id
            ORDER BY l.created_at DESC LIMIT 8
        `);

        res.json({ 
            students: studentsRows[0].count,
            lecturers: lecturersRows[0].count,
            pending: pendingRows[0].count,
            approved: approvedRows[0].count,
            rejected: rejectedRows[0].count,
            totalBooks: totalBooksRows[0].count,
            downloads: downloadsRows[0].count || 0, 
            signups: signupsRows[0].count,
            suspended: suspendedRows[0].count,
            unreadMessages: unreadRows[0].count,
            reviews: reviewsRows[0].count,
            userTrend: monthlyTrend(userTrendRows),
            uploadTrend: monthlyTrend(uploadTrendRows),
            topCategories: { labels: categoryRows.map(r => r.name), data: categoryRows.map(r => r.count) },
            recentActivity: activityRows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/lecturer', authenticate, requireRole('lecturer'), async (req, res) => {
    try {
        const [uploadsRows] = await db.query('SELECT COUNT(*) as count FROM books WHERE uploaded_by = ?', [req.user.user_id]);
        const [approvedRows] = await db.query("SELECT COUNT(*) as count FROM books WHERE uploaded_by = ? AND status = 'approved'", [req.user.user_id]);
        const [pendingRows] = await db.query("SELECT COUNT(*) as count FROM books WHERE uploaded_by = ? AND status = 'pending'", [req.user.user_id]);
        const [downloadsRows] = await db.query('SELECT SUM(downloads_count) as count FROM books WHERE uploaded_by = ?', [req.user.user_id]);
        const [viewsRows] = await db.query('SELECT SUM(views) as count FROM books WHERE uploaded_by = ?', [req.user.user_id]);
        
        const [uploadTrendRows] = await db.query(`
            SELECT ${monthGroupSql('created_at')}, COUNT(*) as count
            FROM books WHERE uploaded_by = ? AND ${monthWindowSql('created_at')}
            GROUP BY ym ORDER BY ym ASC
        `, [req.user.user_id]);
        
        const [topResourcesRows] = await db.query(`
            SELECT book_id, title, views, downloads_count, status
            FROM books WHERE uploaded_by = ? ORDER BY views DESC LIMIT 5
        `, [req.user.user_id]);

        const [recentUploadsRows] = await db.query(`
            SELECT book_id, title, resource_type, status, created_at
            FROM books WHERE uploaded_by = ? ORDER BY created_at DESC LIMIT 10
        `, [req.user.user_id]);
        
        res.json({ 
            uploads: uploadsRows[0].count, 
            approved: approvedRows[0].count,
            pending: pendingRows[0].count,
            downloads: downloadsRows[0].count || 0, 
            views: viewsRows[0].count || 0,
            uploadTrend: monthlyTrend(uploadTrendRows),
            topResources: topResourcesRows,
            recentUploads: recentUploadsRows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/student', authenticate, requireRole('student'), async (req, res) => {
    try {
        const [bookmarksRows] = await db.query('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?', [req.user.user_id]);
        const [downloadsRows] = await db.query('SELECT COUNT(*) as count FROM downloads WHERE user_id = ?', [req.user.user_id]);
        const [reviewsRows] = await db.query('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?', [req.user.user_id]);
        const [notificationsRows] = await db.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.user_id]);

        const [downloadTrendRows] = await db.query(`
            SELECT ${monthGroupSql('downloaded_at')}, COUNT(*) as count
            FROM downloads WHERE user_id = ? AND ${monthWindowSql('downloaded_at')}
            GROUP BY ym ORDER BY ym ASC
        `, [req.user.user_id]);

        const [recentDownloadsRows] = await db.query(`
            SELECT dh.book_id, b.title, b.resource_type, dh.downloaded_at
            FROM downloads dh
            JOIN books b ON b.book_id = dh.book_id
            WHERE dh.user_id = ? ORDER BY dh.downloaded_at DESC LIMIT 10
        `, [req.user.user_id]);

        const [bookmarksListRows] = await db.query(`
            SELECT b.book_id, b.title, b.cover_image,
                (SELECT GROUP_CONCAT(a.name) FROM book_authors ba
                 JOIN authors a ON a.author_id = ba.author_id
                 WHERE ba.book_id = b.book_id) AS authors
            FROM bookmarks bm
            JOIN books b ON b.book_id = bm.book_id
            WHERE bm.user_id = ? ORDER BY bm.created_at DESC LIMIT 8
        `, [req.user.user_id]);

        await Promise.all(bookmarksListRows.map(async (book) => {
            if (book.cover_image) {
                book.cover_image = await storageReadUrl(book.cover_image);
            }
        }));

        res.json({
            bookmarks: bookmarksRows[0].count,
            downloads: downloadsRows[0].count,
            reviews: reviewsRows[0].count,
            unreadNotifications: notificationsRows[0].count,
            downloadTrend: monthlyTrend(downloadTrendRows),
            recentDownloads: recentDownloadsRows,
            bookmarks_list: bookmarksListRows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

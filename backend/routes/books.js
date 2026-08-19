const router = require('express').Router();
const { db } = require('../config/database');
const { BOOKS_PER_PAGE, STORAGE_TYPE, S3_BASE_URL } = require('../config/constants');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { uploadResource, getFileUrl } = require('../middleware/upload');
const { storageReadUrl, storageDelete } = require('../utils/storage');
const { logActivity, paginate } = require('../utils/helpers');

const BOOK_SELECT_FIELDS = `
    b.*, c.name AS category_name, c.slug AS category_slug,
    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE book_id = b.book_id) AS avg_rating,
    (SELECT COUNT(*) FROM reviews WHERE book_id = b.book_id) AS review_count,
    (SELECT GROUP_CONCAT(a.name) FROM book_authors ba JOIN authors a ON a.author_id = ba.author_id WHERE ba.book_id = b.book_id) AS authors
`;

/**
 * Where an uploaded file ended up, as the value to store in `books`.
 *
 * multer-s3 always sets `location`; the rest is fallback. `key` is already the
 * complete object key (`uploads/books/ab12.pdf`), so it must not be passed to
 * getFileUrl(), which prepends the uploads prefix and the folder again — that
 * produced `uploads/books/books/ab12.pdf` and a presigned URL for an object
 * that does not exist.
 */
function uploadedPath(file, folder) {
    if (!file) return null;
    if (file.location) return file.location;
    if (STORAGE_TYPE === 's3') {
        return file.key
            ? `${S3_BASE_URL || ''}/${file.key}`
            : getFileUrl(file.filename, folder);
    }
    return `/uploads/${folder}/${file.filename}`;
}

// Lecturer's own downloads/views listing must be declared before the ':id' route below.
router.get('/downloads/history', authenticate, async (req, res) => {
    try {
        const { page, limit } = req.query;
        const perPage = limit ? parseInt(limit) : BOOKS_PER_PAGE;
        const currentPage = parseInt(page) || 1;

        const [countRows] = await db.query('SELECT COUNT(*) as count FROM downloads WHERE user_id = ?', [req.user.user_id]);
        const { page: safePage, pages, offset } = paginate(countRows[0].count, perPage, currentPage);

        const [rows] = await db.query(`
            SELECT d.download_id, d.downloaded_at, b.book_id, b.title, b.resource_type, c.name AS category_name
            FROM downloads d
            JOIN books b ON b.book_id = d.book_id
            LEFT JOIN categories c ON c.category_id = b.category_id
            WHERE d.user_id = ?
            ORDER BY d.downloaded_at DESC
            LIMIT ? OFFSET ?
        `, [req.user.user_id, perPage, offset]);

        res.json({ data: rows, pagination: { page: safePage, pages, total: countRows[0].count, perPage } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', optionalAuth, async (req, res) => {
    try {
        const { q, category, type, sort, page, limit, status, mine } = req.query;
        const perPage = limit ? parseInt(limit) : BOOKS_PER_PAGE;
        const currentPage = parseInt(page) || 1;

        const conditions = [];
        const params = [];

        if (mine === '1' && req.user) {
            conditions.push('b.uploaded_by = ?');
            params.push(req.user.user_id);
            if (status) { conditions.push('b.status = ?'); params.push(status); }
        } else if (status && req.user && req.user.role_name === 'admin') {
            conditions.push('b.status = ?');
            params.push(status);
        } else {
            conditions.push("b.status = 'approved'");
        }

        if (q) {
            conditions.push(`(b.title LIKE ? OR EXISTS (
                SELECT 1 FROM book_authors ba JOIN authors a ON a.author_id = ba.author_id
                WHERE ba.book_id = b.book_id AND a.name LIKE ?
            ))`);
            params.push(`%${q}%`, `%${q}%`);
        }
        if (category) {
            conditions.push('c.slug = ?');
            params.push(category);
        }
        if (type) {
            conditions.push('b.resource_type = ?');
            params.push(type);
        }

        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const [countRows] = await db.query(
            `SELECT COUNT(*) as count FROM books b LEFT JOIN categories c ON c.category_id = b.category_id ${whereClause}`,
            params
        );
        const total = countRows[0].count;
        const { page: safePage, pages, offset } = paginate(total, perPage, currentPage);

        let orderBy = 'b.title ASC';
        if (sort === 'newest') orderBy = 'b.created_at DESC';
        else if (sort === 'popular') orderBy = 'b.downloads_count DESC';
        else if (sort === 'rating') orderBy = 'avg_rating DESC';

        const [rows] = await db.query(`
            SELECT ${BOOK_SELECT_FIELDS}
            FROM books b
            LEFT JOIN categories c ON c.category_id = b.category_id
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `, [...params, perPage, offset]);

        await Promise.all(rows.map(async (book) => {
            if (book.cover_image) {
                book.cover_image = await storageReadUrl(book.cover_image);
            }
        }));

        res.json({ data: rows, pagination: { page: safePage, pages, total, perPage } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT ${BOOK_SELECT_FIELDS},
                u.first_name AS uploader_first_name, u.last_name AS uploader_last_name
            FROM books b
            LEFT JOIN categories c ON c.category_id = b.category_id
            LEFT JOIN users u ON u.user_id = b.uploaded_by
            WHERE b.book_id = ?
        `, [req.params.id]);
        const book = rows[0];
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (book.cover_image) {
            book.cover_image = await storageReadUrl(book.cover_image);
        }
        await db.query('UPDATE books SET views = views + 1 WHERE book_id = ?', [book.book_id]);
        res.json(book);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id/file', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT file_path, status, uploaded_by FROM books WHERE book_id = ?',
            [req.params.id]
        );
        const book = rows[0];
        if (!book) return res.status(404).json({ error: 'Book not found' });

        const isAdmin = req.user.role_name === 'admin';
        const isOwner = book.uploaded_by === req.user.user_id;
        if (book.status !== 'approved' && !isAdmin && !isOwner) {
            return res.status(404).json({ error: 'Book not found' });
        }

        const fileUrl = await storageReadUrl(book.file_path);
        if (!fileUrl) return res.status(404).json({ error: 'Book file not found' });
        res.json({ fileUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, requireRole('lecturer'), uploadResource, async (req, res) => {
    try {
        const { title, description, resource_type, category_id, authors, isbn, publication_year, downloadable } = req.body;
        const resourceFile = req.files?.resource_file?.[0];

        if (!title || !resource_type || !category_id || !resourceFile) {
            return res.status(400).json({ error: 'Title, category, resource type and PDF file are required.' });
        }

        const categoryId = category_id === '' || category_id === null || category_id === undefined ? null : Number(category_id);
        const uploadPath = uploadedPath(resourceFile, 'books');
        const coverPath = uploadedPath(req.files?.cover_image?.[0], 'covers');
        const fileSizeKb = Math.max(1, Math.ceil((resourceFile?.size || 0) / 1024));

        const [result] = await db.query(
            `INSERT INTO books (title, description, category_id, uploaded_by, resource_type, file_path, cover_image, file_size_kb, isbn, publication_year, downloadable, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                title.trim(),
                description || '',
                categoryId,
                req.user.user_id,
                resource_type,
                uploadPath,
                coverPath,
                fileSizeKb,
                isbn || null,
                publication_year || null,
                downloadable === '1' || downloadable === true || downloadable === 1 ? 1 : 0
            ]
        );

        const bookId = result.insertId;
        await syncBookAuthors(bookId, authors);

        await db.query(
            'INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)',
            [req.user.user_id, 'resource_uploaded', `Lecturer uploaded resource "${title.trim()}"`]
        );

        res.status(201).json({ message: 'Book uploaded successfully', bookId });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message || 'Failed to upload resource.' });
    }
});

/** Replace a book's author links with the supplied comma-separated names. */
async function syncBookAuthors(bookId, authorsInput) {
    const authorNames = (authorsInput || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

    await db.query('DELETE FROM book_authors WHERE book_id = ?', [bookId]);

    for (const authorName of authorNames) {
        const [existing] = await db.query('SELECT author_id FROM authors WHERE name = ?', [authorName]);
        let authorId;

        if (existing.length > 0) {
            authorId = existing[0].author_id;
        } else {
            const [inserted] = await db.query('INSERT INTO authors (name) VALUES (?)', [authorName]);
            authorId = inserted.insertId;
        }

        await db.query(
            'INSERT IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)',
            [bookId, authorId]
        );
    }
}

router.put('/:id', authenticate, requireRole('lecturer'), uploadResource, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT book_id, uploaded_by, file_path, cover_image, status FROM books WHERE book_id = ?',
            [req.params.id]
        );
        const book = rows[0];
        if (!book) return res.status(404).json({ error: 'Book not found' });

        if (book.uploaded_by !== req.user.user_id) {
            return res.status(403).json({ error: 'You can only edit resources you uploaded.' });
        }

        const { title, description, resource_type, category_id, authors, isbn, publication_year, downloadable } = req.body;

        const fields = [];
        const params = [];
        const set = (column, value) => { fields.push(`${column} = ?`); params.push(value); };

        if (title !== undefined) {
            if (!title.trim()) return res.status(400).json({ error: 'Title cannot be empty.' });
            set('title', title.trim());
        }
        if (description !== undefined) set('description', description || '');
        if (resource_type !== undefined) set('resource_type', resource_type);
        if (category_id !== undefined) {
            set('category_id', category_id === '' || category_id === null ? null : Number(category_id));
        }
        if (isbn !== undefined) set('isbn', isbn || null);
        if (publication_year !== undefined) set('publication_year', publication_year || null);
        if (downloadable !== undefined) {
            set('downloadable', downloadable === '1' || downloadable === true || downloadable === 1 ? 1 : 0);
        }

        // A replaced file sends the resource back for re-approval.
        const newResource = req.files?.resource_file?.[0];
        const newCover = req.files?.cover_image?.[0];
        const oldPaths = [];

        if (newResource) {
            set('file_path', uploadedPath(newResource, 'books'));
            set('file_size_kb', Math.max(1, Math.ceil((newResource.size || 0) / 1024)));
            set('status', 'pending');
            set('rejection_reason', null);
            if (book.file_path) oldPaths.push(book.file_path);
        }

        if (newCover) {
            set('cover_image', uploadedPath(newCover, 'covers'));
            if (book.cover_image) oldPaths.push(book.cover_image);
        }

        if (fields.length) {
            params.push(book.book_id);
            await db.query(`UPDATE books SET ${fields.join(', ')} WHERE book_id = ?`, params);
        }

        if (authors !== undefined) {
            await syncBookAuthors(book.book_id, authors);
        }

        // Only discard the superseded files once the row points elsewhere.
        for (const oldPath of oldPaths) {
            await storageDelete(oldPath);
        }

        await logActivity(
            req.user.user_id,
            'resource_updated',
            `Lecturer updated resource #${book.book_id}`,
            req.ip
        );

        res.json({
            message: 'Book updated',
            bookId: book.book_id,
            requiresReapproval: Boolean(newResource),
        });
    } catch (err) {
        console.error('Book update error:', err);
        res.status(500).json({ error: err.message || 'Failed to update resource.' });
    }
});

router.delete('/:id', authenticate, requireRole('lecturer'), async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT book_id, title, uploaded_by, file_path, cover_image FROM books WHERE book_id = ?',
            [req.params.id]
        );
        const book = rows[0];
        if (!book) return res.status(404).json({ error: 'Book not found' });

        // Admins manage any resource through /api/admin/books/:id instead.
        if (book.uploaded_by !== req.user.user_id) {
            return res.status(403).json({ error: 'You can only delete resources you uploaded.' });
        }

        // Child rows (book_authors, downloads, bookmarks, reviews) are removed
        // by ON DELETE CASCADE in database/schema.sql.
        await db.query('DELETE FROM books WHERE book_id = ?', [book.book_id]);

        await storageDelete(book.file_path);
        if (book.cover_image) await storageDelete(book.cover_image);

        await logActivity(
            req.user.user_id,
            'resource_deleted',
            `Lecturer deleted resource "${book.title}"`,
            req.ip
        );

        res.json({ message: 'Book deleted', bookId: book.book_id });
    } catch (err) {
        console.error('Book delete error:', err);
        res.status(500).json({ error: err.message || 'Failed to delete resource.' });
    }
});

router.post('/:id/download', authenticate, async (req, res) => {
    try {
        const [bookRows] = await db.query(
            'SELECT file_path, downloadable, status, uploaded_by FROM books WHERE book_id = ?',
            [req.params.id]
        );
        const book = bookRows[0];
        if (!book) return res.status(404).json({ error: 'Book not found' });

        // Same visibility rule as GET /:id/file — an unapproved resource must not
        // be downloadable by anyone except its uploader or an admin.
        const isAdmin = req.user.role_name === 'admin';
        const isOwner = book.uploaded_by === req.user.user_id;
        if (book.status !== 'approved' && !isAdmin && !isOwner) {
            return res.status(404).json({ error: 'Book not found' });
        }

        if (book.downloadable === 0) return res.status(403).json({ error: 'This resource is not downloadable.' });

        await db.query('UPDATE books SET downloads_count = downloads_count + 1 WHERE book_id = ?', [req.params.id]);
        await db.query('INSERT INTO downloads (user_id, book_id) VALUES (?, ?)', [req.user.user_id, req.params.id]);
        const downloadUrl = await storageReadUrl(book.file_path);
        if (!downloadUrl) return res.status(404).json({ error: 'Book file not found' });
        res.json({ downloadUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

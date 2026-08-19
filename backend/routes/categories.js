const router = require('express').Router();
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { slugify, clean } = require('../utils/helpers');

const DEFAULT_ICON = 'bi-journal-bookmark';

router.get('/', async (req, res) => {
    try {
        const [categories] = await db.query(`
            SELECT c.*, (SELECT COUNT(*) FROM books b WHERE b.category_id = c.category_id AND b.status = 'approved') AS resource_count
            FROM categories c
            ORDER BY c.name ASC
        `);
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const name = clean(req.body.name);
        if (!name) return res.status(400).json({ error: 'Category name is required.' });

        // `slug` is NOT NULL with no default, so it must always be supplied.
        const slug = clean(req.body.slug) || slugify(name);

        const [result] = await db.query(
            'INSERT INTO categories (name, slug, description, icon) VALUES (?, ?, ?, ?)',
            [name, slug, clean(req.body.description) || null, clean(req.body.icon) || DEFAULT_ICON]
        );
        res.status(201).json({ category_id: result.insertId, id: result.insertId, slug });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'A category with that name already exists.' });
        }
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const name = clean(req.body.name);
        if (!name) return res.status(400).json({ error: 'Category name is required.' });

        const slug = clean(req.body.slug) || slugify(name);

        const [result] = await db.query(
            'UPDATE categories SET name = ?, slug = ?, description = ?, icon = ? WHERE category_id = ?',
            [
                name,
                slug,
                clean(req.body.description) || null,
                clean(req.body.icon) || DEFAULT_ICON,
                req.params.id,
            ]
        );

        if (!result.affectedRows) return res.status(404).json({ error: 'Category not found.' });
        res.json({ message: 'Updated' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'A category with that name already exists.' });
        }
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        // books.category_id is ON DELETE SET NULL, so affected books survive.
        const [result] = await db.query('DELETE FROM categories WHERE category_id = ?', [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Category not found.' });
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

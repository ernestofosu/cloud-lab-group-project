const router = require('express').Router();
const { db } = require('../config/database');

router.post('/', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        if (!name || !email || !message) return res.status(400).json({ error: 'All fields required' });

        // contact.html posts a `subject` field and contact_messages has the
        // column, so persist it instead of dropping what the user typed.
        await db.query(
            'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
            [name, email, subject || null, message]
        );
        res.status(201).json({ message: 'Message sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

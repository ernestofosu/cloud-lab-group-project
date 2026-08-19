const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/constants');
const { authenticate } = require('../middleware/auth');
const { authCookieOptions, clearCookieOptions } = require('../config/cookies');
const { uploadProfilePhoto } = require('../middleware/upload');
const { logActivity } = require('../utils/helpers');
const { updateUserProfile } = require('../utils/profile');

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const [rows] = await db.query(
            `SELECT u.user_id, u.first_name, u.last_name, u.email, u.password_hash,
                    u.status, u.failed_logins, u.locked_until, r.role_name
             FROM users u JOIN roles r ON r.role_id = u.role_id
             WHERE u.email = ?`,
            [email]
        );
        const user = rows[0];

        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(401).json({ error: 'Account locked. Try again later.' });
        }

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) {
            let attempts = (user.failed_logins || 0) + 1;
            let locked_until = null;
            if (attempts >= 5) {
                // MySQL DATETIME does not accept the 'Z'/'T' of an ISO string.
                locked_until = new Date(Date.now() + 5 * 60 * 1000)
                    .toISOString().slice(0, 19).replace('T', ' ');
                attempts = 0;
            }
            await db.query('UPDATE users SET failed_logins = ?, locked_until = ? WHERE user_id = ?', [attempts, locked_until, user.user_id]);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user account is suspended
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Your account has been suspended. Please contact an administrator.' });
        }

        await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE user_id = ?', [user.user_id]);

        const token = jwt.sign({ userId: user.user_id, role: user.role_name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.cookie('token', token, authCookieOptions());

        await logActivity(user.user_id, 'user_login', `User ${user.email} logged in`);

        const safeUser = {
            ...user,
            id: user.user_id,
            user_id: user.user_id,
            role: user.role_name,
            role_name: user.role_name
        };
        delete safeUser.password_hash;

        res.json({ message: 'Login successful', user: safeUser, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/register', async (req, res) => {
    try {
        const { first_name, last_name, email, password, password_confirm, role, institution_id, department } = req.body;
        
        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (password !== password_confirm) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }
        if (!['student', 'lecturer'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Check if email already exists
        const [existingRows] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
        if (existingRows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Get role_id from role_name
        const [roleRows] = await db.query('SELECT role_id FROM roles WHERE role_name = ?', [role]);
        if (roleRows.length === 0) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        const role_id = roleRows[0].role_id;

        // Hash password and insert user
        const hash = bcrypt.hashSync(password, 10);
        const [result] = await db.query(
            'INSERT INTO users (first_name, last_name, email, password_hash, role_id, institution_id, department, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [first_name, last_name, email, hash, role_id, institution_id || null, department || null, 'active']
        );
        
        res.status(201).json({ message: 'Registered successfully', userId: result.insertId });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token', clearCookieOptions());
    res.json({ message: 'Logged out' });
});

// Password reset needs an email transport, which is not configured. These used
// to return a success message without doing anything, which made the frontend
// tell users a reset link had been sent when none had.
router.post('/forgot-password', (req, res) => {
    res.status(501).json({
        error: 'Password reset by email is not available yet. Please ask an administrator to reset your password.',
    });
});

router.post('/reset-password', (req, res) => {
    res.status(501).json({
        error: 'Password reset by email is not available yet. Please ask an administrator to reset your password.',
    });
});

router.get('/me', authenticate, async (req, res) => {
    res.json({ user: req.user });
});

router.put('/password', authenticate, async (req, res) => {
    try {
        const { old_password, new_password } = req.body;
        if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Password too short' });

        const [rows] = await db.query('SELECT password_hash FROM users WHERE user_id = ?', [req.user.user_id]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'Account not found' });
        if (!bcrypt.compareSync(old_password || '', user.password_hash)) return res.status(400).json({ error: 'Invalid old password' });

        const hash = bcrypt.hashSync(new_password, 10);
        await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, req.user.user_id]);

        res.json({ message: 'Password updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/profile', authenticate, uploadProfilePhoto, async (req, res) => {
    try {
        const { user } = await updateUserProfile(req);
        res.json({ message: 'Profile updated', user });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

module.exports = router;

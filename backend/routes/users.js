const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { uploadProfilePhoto } = require('../middleware/upload');
const { updateUserProfile } = require('../utils/profile');

router.get('/me', authenticate, async (req, res) => {
    res.json({ user: req.user });
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

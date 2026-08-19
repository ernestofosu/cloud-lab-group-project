/**
 * JWT Authentication middleware
 */
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');
const { db } = require('../config/database');
const { clearCookieOptions } = require('../config/cookies');

/** Extract and verify JWT from cookie or Authorization header */
async function authenticate(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verify user still exists and is active
    const [rows] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
              u.institution_id, u.department, u.profile_photo, u.status,
              u.created_at, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = ?`, [decoded.userId]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Account not found.' });
    }
    if (user.status !== 'active') {
      res.clearCookie('token', clearCookieOptions());
      return res.status(403).json({ error: 'Your account has been suspended.' });
    }

    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('token', clearCookieOptions());
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

/** Optional auth — sets req.user if token present, but doesn't block */
async function optionalAuth(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
              u.institution_id, u.department, u.profile_photo, u.status,
              u.created_at, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = ? AND u.status = 'active'`, [decoded.userId]
    );
    if (rows[0]) req.user = rows[0];
  } catch (_) { /* ignore invalid tokens */ }
  next();
}

/** Role-based access control */
function requireRole(...roles) {
  return [authenticate, (req, res, next) => {
    if (!roles.includes(req.user.role_name)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource.' });
    }
    next();
  }];
}

module.exports = { authenticate, optionalAuth, requireRole };

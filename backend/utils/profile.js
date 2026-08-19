/**
 * Shared profile-update logic used by both PUT /api/users/profile and
 * PUT /api/auth/profile, so the two endpoints can never drift apart.
 */
const { db } = require('../config/database');
const { clean } = require('./helpers');
const { storageReadUrl } = require('./storage');

// Columns a user is allowed to change about themselves. Must match
// database/schema.sql — there is no `bio` or `avatar_url` column.
const EDITABLE_COLUMNS = ['first_name', 'last_name', 'phone', 'department', 'institution_id'];

/**
 * Apply a partial profile update for the authenticated user and return the
 * refreshed user record (with a usable profile photo URL).
 *
 * @returns {Promise<{user: object}>}
 * @throws {Error} with `.status = 400` when nothing updatable was supplied.
 */
async function updateUserProfile(req) {
  const userId = req.user.user_id;
  const fields = [];
  const params = [];

  // Only touch columns the caller actually sent, so a partial form submit
  // never blanks out unrelated profile data.
  for (const column of EDITABLE_COLUMNS) {
    if (req.body[column] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(clean(req.body[column]) || null);
    }
  }

  if (req.file) {
    fields.push('profile_photo = ?');
    // `key` (S3) is the full object key and round-trips through storageReadUrl
    // unchanged. On local disk multer only gives a bare filename, and the file
    // lives in uploads/profiles/, so the folder has to be put back or the
    // stored path resolves to /uploads/<name> and the image 404s.
    params.push(req.file.key || req.file.location || `profiles/${req.file.filename}`);
  }

  if (!fields.length) {
    const err = new Error('No profile fields were provided.');
    err.status = 400;
    throw err;
  }

  params.push(userId);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`, params);

  const [rows] = await db.query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
            u.institution_id, u.department, u.profile_photo, u.status,
            u.created_at, r.role_name
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = ?`,
    [userId]
  );

  const user = rows[0];
  if (user && user.profile_photo) {
    user.profile_photo = await storageReadUrl(user.profile_photo);
  }

  return { user };
}

module.exports = { updateUserProfile, EDITABLE_COLUMNS };

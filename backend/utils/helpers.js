/**
 * Helper utilities
 */
const { db } = require('../config/database');

/** Log user activity */
async function logActivity(userId, action, description, ipAddress) {
  try {
    await db.query(
      'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
      [userId, action, description || '', ipAddress || null]
    );
  } catch (e) {
    console.error('Activity log failed:', e.message);
  }
}

/** Generate a URL-safe slug from text */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

/** Human-readable time ago */
function timeAgo(datetime) {
  if (!datetime) return 'just now';
  const parsed = new Date(datetime);
  if (isNaN(parsed.getTime())) return 'just now';

  const diff = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
  if (diff < 604800) return Math.floor(diff / 86400) + ' day(s) ago';
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Pagination helper */
function paginate(totalRows, perPage, currentPage) {
  const totalPages = Math.max(1, Math.ceil(totalRows / perPage));
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  return {
    page: currentPage,
    pages: totalPages,
    offset: (currentPage - 1) * perPage,
    total: totalRows,
  };
}

/** Clean/trim input */
function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\0/g, '').trim();
}

/**
 * Turn `[{ ym: 'YYYY-MM', count }]` rows into aligned {labels, data} arrays
 * covering the last `monthsBack` months (including the current one), filling
 * any months without rows with 0.
 */
function monthlyTrend(rows, monthsBack = 6) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const byMonth = {};
  (rows || []).forEach((r) => { byMonth[r.ym] = r.count; });

  const now = new Date();
  const labels = [];
  const data = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(monthNames[d.getMonth()]);
    data.push(byMonth[ym] || 0);
  }
  return { labels, data };
}

module.exports = { logActivity, slugify, timeAgo, paginate, clean, monthlyTrend };

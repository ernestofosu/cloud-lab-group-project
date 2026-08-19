/**
 * Database seed / verification script.
 *
 * Applies database/schema.sql and seeds reference data (via initDB), then
 * prints what is in the database so you can confirm the connection works.
 *
 *   cd backend && npm run seed
 */
const path = require('path');

// initDB reads process.env directly, so backend/.env must be loaded explicitly —
// running this script from database/ would otherwise pick up no configuration
// at all and fail against the wrong host.
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const { initDB, db } = require('../backend/config/database');

async function seed() {
  console.log(`Connecting to MySQL at ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  await initDB();

  const [roles] = await db.query('SELECT role_id, role_name FROM roles ORDER BY role_id');
  console.log(`\nRoles (${roles.length}):`, roles.map((r) => r.role_name).join(', '));

  const [users] = await db.query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, r.role_name
     FROM users u JOIN roles r ON r.role_id = u.role_id ORDER BY u.user_id`
  );
  console.log(`\nUsers (${users.length}):`);
  users.forEach((u) => console.log(`  #${u.user_id} ${u.email} (${u.role_name})`));

  const [categories] = await db.query('SELECT category_id, name FROM categories ORDER BY name');
  console.log(`\nCategories (${categories.length}):`, categories.map((c) => c.name).join(', '));

  const [books] = await db.query('SELECT book_id, title, status FROM books ORDER BY book_id');
  console.log(`\nBooks (${books.length}):`);
  books.forEach((b) => console.log(`  #${b.book_id} [${b.status}] ${b.title}`));

  console.log('\nSeed complete. Default admin credentials:');
  console.log('  Email:    admin@athenaeum.edu.gh');
  console.log(`  Password: ${process.env.ADMIN_SEED_PASSWORD || 'Admin@12345'}`);
  console.log('  ^ change this immediately after first login.');

  await db.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});

/**
 * Database connection — MySQL only (local MySQL / AWS RDS / Aurora MySQL)
 *
 * Exposes a thin proxy over a mysql2/promise pool so routes can `db.query(...)`
 * without caring about pool lifecycle. On first boot the schema in
 * database/schema.sql is applied (idempotently) and reference data is seeded.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

let pool = null;

const SCHEMA_PATH = path.join(__dirname, '../../database/schema.sql');

/**
 * Build the pool options. Names here MUST match mysql2's validOptions list —
 * unknown keys are silently ignored by mysql2 and the setting has no effect.
 */
function buildPoolConfig(includeDatabase = true) {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    connectionLimit: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    connectTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 10000,
    waitForConnections: process.env.DB_WAIT_FOR_CONNECTIONS !== 'false',
    queueLimit: 0,
    enableKeepAlive: process.env.DB_ENABLE_KEEP_ALIVE !== 'false',
    keepAliveInitialDelay: parseInt(process.env.DB_KEEP_ALIVE_INTERVAL, 10) || 0,
    idleTimeout: 60000,
    timezone: process.env.DB_TIMEZONE || 'Z',
    charset: 'utf8mb4_general_ci',
  };

  if (includeDatabase) {
    config.database = process.env.DB_NAME || 'gt_library';
  }

  // RDS/Aurora require TLS when the parameter group sets
  // require_secure_transport=ON. Opt in with DB_SSL=true, or point
  // DB_SSL_CA at the downloaded RDS CA bundle for full verification.
  if (String(process.env.DB_SSL).toLowerCase() === 'true' || process.env.DB_SSL_CA) {
    if (process.env.DB_SSL_CA && fs.existsSync(process.env.DB_SSL_CA)) {
      config.ssl = {
        ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf-8'),
        rejectUnauthorized: true,
      };
    } else {
      config.ssl = { rejectUnauthorized: false };
    }
  }

  return config;
}

/**
 * Create the database if it is missing, so a brand-new RDS instance works
 * without a manual step. Uses a short-lived connection with no database bound.
 */
async function ensureDatabaseExists() {
  const dbName = process.env.DB_NAME || 'gt_library';
  const conn = await mysql.createConnection(buildPoolConfig(false));
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '')}\` ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'
    );
  } finally {
    await conn.end();
  }
}

/**
 * Apply database/schema.sql against the pool.
 *
 * The file starts with CREATE DATABASE / USE, which must be stripped: `USE`
 * binds to a single pooled connection, so subsequent DDL could land on a
 * connection with no database selected. Every remaining statement is
 * CREATE TABLE IF NOT EXISTS, so this is safe to run on every boot.
 */
async function applySchema(pool) {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema file not found at ${SCHEMA_PATH}`);
  }

  const raw = fs.readFileSync(SCHEMA_PATH, 'utf-8');

  const statements = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((stmt) => stmt.trim())
    .filter(Boolean)
    .filter((stmt) => !/^(CREATE\s+DATABASE|USE)\b/i.test(stmt));

  let created = 0;
  for (const statement of statements) {
    const [result] = await pool.query(statement);
    // warningStatus > 0 on CREATE TABLE IF NOT EXISTS means "already existed".
    if (result && result.warningStatus === 0) created += 1;
  }

  const [tables] = await pool.query(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()'
  );

  console.log(
    `✓ Schema applied (${statements.length} statements, ${created} new, ` +
    `${tables[0].count} tables present)`
  );
}

async function ensureSeededMySQL(pool) {
  // Seed default roles
  const defaultRoles = ['admin', 'student', 'lecturer'];
  for (const roleName of defaultRoles) {
    await pool.query('INSERT IGNORE INTO roles (role_name) VALUES (?)', [roleName]);
  }

  // Seed default categories
  const defaultCategories = [
    { name: 'Arts & Humanities', slug: 'arts-humanities', description: 'Arts, languages, history and humanities studies.', icon: 'bi-palette' },
    { name: 'Business & Management', slug: 'business-management', description: 'Finance, management, entrepreneurship and strategy.', icon: 'bi-briefcase' },
    { name: 'Computer Science', slug: 'computer-science', description: 'Programming, software engineering and computing topics.', icon: 'bi-cpu' },
    { name: 'Engineering', slug: 'engineering', description: 'Civil, mechanical and general engineering resources.', icon: 'bi-gear' },
    { name: 'Health Sciences', slug: 'health-sciences', description: 'Medical and health-related academic materials.', icon: 'bi-heart-pulse' },
    { name: 'Law', slug: 'law', description: 'Legal theory, governance and public policy resources.', icon: 'bi-bank' },
    { name: 'Mathematics & Statistics', slug: 'mathematics-statistics', description: 'Statistics, algebra, calculus and quantitative methods.', icon: 'bi-calculator' },
    { name: 'Past Examination Papers', slug: 'past-examination-papers', description: 'Past papers and revision assessments.', icon: 'bi-file-earmark-text' }
  ];

  for (const category of defaultCategories) {
    await pool.query(
      'INSERT IGNORE INTO categories (name, slug, description, icon) VALUES (?, ?, ?, ?)',
      [category.name, category.slug, category.description, category.icon]
    );
  }

  // Seed default admin user
  const [adminRole] = await pool.query('SELECT role_id FROM roles WHERE role_name = ?', ['admin']);
  const adminRoleId = adminRole[0]?.role_id;
  if (!adminRoleId) throw new Error('Failed to seed the admin role');

  const [adminExists] = await pool.query(
    'SELECT user_id FROM users WHERE email = ?',
    ['admin@athenaeum.edu.gh']
  );

  if (!adminExists.length) {
    const hash = bcrypt.hashSync(process.env.ADMIN_SEED_PASSWORD || 'Admin@12345', 10);
    await pool.query(
      'INSERT INTO users (first_name, last_name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      ['System', 'Administrator', 'admin@athenaeum.edu.gh', hash, adminRoleId, 'active']
    );
    console.log('✓ Admin user created (admin@athenaeum.edu.gh)');
  }

  console.log('✓ Reference data seeded (roles, categories, admin)');
}

async function initDB() {
  if (pool) return pool;

  const dbType = (process.env.DB_TYPE || 'mysql').toLowerCase();
  if (dbType !== 'mysql') {
    throw new Error(
      `Unsupported DB_TYPE "${dbType}". This application is MySQL-only — ` +
      'set DB_TYPE=mysql (or leave it unset) in backend/.env.'
    );
  }

  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || 3306;
  const name = process.env.DB_NAME || 'gt_library';
  console.log(`🔗 Connecting to MySQL at ${host}:${port}/${name}`);

  try {
    await ensureDatabaseExists();
    pool = mysql.createPool(buildPoolConfig(true));

    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    console.log('✓ MySQL connection pool established');

    // Both of these throw on failure — a half-initialised database must not
    // look like a successful boot, because every route would then return 500.
    await applySchema(pool);
    await ensureSeededMySQL(pool);

    return pool;
  } catch (error) {
    if (pool) {
      try { await pool.end(); } catch (_) { /* pool may already be down */ }
      pool = null;
    }
    console.error('✗ MySQL initialization failed:', error.message);
    if (error.code) console.error('  MySQL error code:', error.code);
    throw error;
  }
}

const dbProxy = {
  query: async (...args) => {
    if (!pool) throw new Error('Database not initialized');
    return pool.query(...args);
  },

  execute: async (...args) => {
    if (!pool) throw new Error('Database not initialized');
    return pool.execute(...args);
  },

  getConnection: async () => {
    if (!pool) throw new Error('Database not initialized');
    return pool.getConnection();
  },

  end: async () => {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};

module.exports = { initDB, db: dbProxy, getDbType: () => 'mysql' };

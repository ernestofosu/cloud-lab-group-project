/**
 * GT Library — Express Server
 * MySQL (RDS/Aurora) + S3 (AWS SDK v3)
 */
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const constants = require('./config/constants');
const { initDB, db } = require('./config/database');
const { reportS3Status, closeS3Client } = require('./config/s3');

const app = express();

// ========== AWS S3 ==========
// The client itself is created lazily in config/s3.js; this only reports the
// resolved configuration so misconfiguration is visible at boot.
reportS3Status();

// ========== CORS ==========
const corsOptions = {
  origin: function (origin, callback) {
    // Requests with no Origin header (curl, health checks, server-to-server).
    if (!origin || constants.ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    // Log the actual origin — a bare 403 gives no way to diagnose which
    // frontend URL needs adding to ALLOWED_ORIGINS.
    console.warn(
      `⚠ CORS rejected origin "${origin}". Add it to ALLOWED_ORIGINS in backend/.env ` +
      `(currently: ${constants.ALLOWED_ORIGINS.join(', ')})`
    );
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: constants.CORS_CREDENTIALS,
  methods: constants.CORS_METHODS,
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// ========== Global Middleware ==========
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(cookieParser());

// Serve uploaded files (local storage only)
if (constants.STORAGE_TYPE === 'local') {
  app.use('/uploads', express.static(constants.UPLOAD_DIR));
}

// Serve frontend files only when the frontend is deployed alongside the
// backend. In production the frontend is hosted separately in S3.
const frontendDir = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.join(__dirname, '..', 'frontend');
const hasLocalFrontend = fs.existsSync(path.join(frontendDir, 'index.html'));

if (hasLocalFrontend) {
  app.use(express.static(frontendDir));
}

// ========== Database Initialization & API Setup ==========
initDB()
  .then(() => {
    console.log('✓ Database initialized (MYSQL)');

    // ========== API Routes ==========
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/books', require('./routes/books'));
    app.use('/api/categories', require('./routes/categories'));
    app.use('/api/reviews', require('./routes/reviews'));
    app.use('/api/bookmarks', require('./routes/bookmarks'));
    app.use('/api/notifications', require('./routes/notifications'));
    app.use('/api/announcements', require('./routes/announcements'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/contact', require('./routes/contact'));
    app.use('/api/stats', require('./routes/stats'));
    app.use('/api/admin', require('./routes/admin'));

    // ========== Health Check ==========
    // Actually touches the database, so a healthy response means the API can
    // serve requests — not merely that the process is alive.
    app.get('/api/health', async (req, res) => {
      try {
        await db.query('SELECT 1');
        res.json({
          status: 'healthy',
          database: 'mysql',
          storage: constants.STORAGE_TYPE,
          environment: constants.NODE_ENV,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        res.status(503).json({
          status: 'unhealthy',
          database: 'mysql',
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // ========== SPA Fallback ==========
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Route not found' });
      }
      if (!hasLocalFrontend) {
        return res.status(404).json({ error: 'Route not found' });
      }

      const reqPath = req.path.endsWith('/') ? req.path + 'index.html' : req.path;
      const filePath = path.join(
        frontendDir,
        reqPath.endsWith('.html') ? reqPath : reqPath + '.html'
      );

      if (filePath.startsWith(frontendDir) && fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      res.sendFile(path.join(frontendDir, 'index.html'));
    });

    // ========== Global Error Handler ==========
    app.use((err, req, res, next) => {
      console.error('Error:', err.message);

      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds limit' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: `Unexpected file field "${err.field}"` });
      }
      if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ error: 'CORS policy violation' });
      }
      if (err.message && err.message.startsWith('Only')) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: err.message || 'Internal Server Error' });
    });

    // ========== Start Server ==========
    const PORT = constants.PORT;
    const HOST = constants.HOST;

    const server = app.listen(PORT, HOST, () => {
      console.log(`
╔════════════════════════════════════════╗
║   🚀 GT Library Backend Started        ║
╠════════════════════════════════════════╣
║ Environment: ${constants.NODE_ENV.padEnd(20)}  ║
║ Host: ${HOST.padEnd(30)}  ║
║ Port: ${PORT.toString().padEnd(29)}  ║
║ Database: MYSQL                        ║
║ Storage: ${constants.STORAGE_TYPE.toUpperCase().padEnd(28)}  ║
║ CORS Origin: ${constants.CORS_ORIGIN.substring(0, 26).padEnd(27)}  ║
╚════════════════════════════════════════╝
      `);
    });

    // ========== Graceful Shutdown ==========
    let shuttingDown = false;
    async function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${signal} received — shutting down.`);

      server.close(async () => {
        try {
          await db.end();
          await closeS3Client();
        } catch (err) {
          console.error('Shutdown cleanup failed:', err.message);
        }
        process.exit(0);
      });

      // Don't hang forever on lingering keep-alive connections.
      setTimeout(() => process.exit(1), 10000).unref();
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('✗ Database initialization failed:', err.message);
    console.error('Stack:', err.stack);
    console.error(
      '\nThe API cannot serve requests without the database. Check that:\n' +
      '  • DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME in backend/.env are correct\n' +
      '  • the RDS security group allows inbound 3306 from this EC2 instance\n' +
      "  • DB_SSL=true is set if the parameter group requires secure transport\n"
    );
    process.exit(1);
  });

// A rejected promise or thrown error outside a request must not silently kill
// the process — that presents to users as the frontend going quiet.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.stack || err.message);
  // An uncaught exception leaves the process in an unknown state. Exit so the
  // supervisor (systemd/pm2) restarts it cleanly instead of limping on.
  process.exit(1);
});

module.exports = app;

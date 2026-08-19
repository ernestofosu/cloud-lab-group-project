/**
 * Application constants — Environment-aware configuration
 */
const path = require('path');

module.exports = {
  // Application
  APP_NAME: process.env.APP_NAME || 'GT Library',
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Africa/Accra',
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Server
  PORT: parseInt(process.env.PORT, 10) || 3000,
  HOST: process.env.HOST || 'localhost',
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',

  // JWT & Security
  JWT_SECRET: process.env.JWT_SECRET || 'gt-library-dev-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  JWT_ALGORITHM: process.env.JWT_ALGORITHM || 'HS256',
  SESSION_IDLE_LIMIT: parseInt(process.env.SESSION_IDLE_LIMIT, 10) || 1800, // 30 minutes

  // File Storage
  STORAGE_TYPE: process.env.STORAGE_TYPE || 'local', // 'local' or 's3'
  UPLOAD_DIR: path.join(__dirname, '..', 'uploads'),
  MAX_UPLOAD_BYTES: parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 26214400, // 25 MB
  MAX_COVER_BYTES: parseInt(process.env.MAX_COVER_BYTES, 10) || 3145728, // 3 MB

  // MIME Types
  ALLOWED_RESOURCE_MIMES: {
    'application/pdf': 'pdf',
  },

  ALLOWED_IMAGE_MIMES: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  },

  // Resource Configuration
  RESOURCE_TYPE_LABELS: {
    book: 'Book',
    lecture_note: 'Lecture Note',
    research_paper: 'Research Paper',
    assignment: 'Assignment',
    past_question: 'Past Examination Paper',
  },

  BOOKS_PER_PAGE: parseInt(process.env.BOOKS_PER_PAGE, 10) || 12,

  // Database Configuration (MySQL only)
  DB_TYPE: 'mysql',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT, 10) || 3306,
  DB_USER: process.env.DB_USER || 'root',
  DB_PASS: process.env.DB_PASS || '',
  DB_NAME: process.env.DB_NAME || 'gt_library',
  DB_TIMEZONE: process.env.DB_TIMEZONE || 'Z',
  DB_POOL_MIN: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  DB_CONNECTION_TIMEOUT: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 10000,
  DB_WAIT_FOR_CONNECTIONS: process.env.DB_WAIT_FOR_CONNECTIONS !== 'false',
  DB_ENABLE_KEEP_ALIVE: process.env.DB_ENABLE_KEEP_ALIVE !== 'false',
  DB_KEEP_ALIVE_INTERVAL: parseInt(process.env.DB_KEEP_ALIVE_INTERVAL, 10) || 30000,

  // AWS S3 Configuration
  AWS_REGION: process.env.AWS_REGION || 'eu-north-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET, // Public bucket (frontend)
  AWS_S3_UPLOADS_BUCKET: process.env.AWS_S3_UPLOADS_BUCKET, // Private bucket (file uploads)
  AWS_S3_ACL: process.env.AWS_S3_ACL || 'private',
  S3_BASE_URL: process.env.S3_BASE_URL,
  S3_UPLOADS_PREFIX: process.env.S3_UPLOADS_PREFIX || 'uploads/',

  // CORS Configuration
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim()),
  CORS_CREDENTIALS: process.env.CORS_CREDENTIALS === 'true',
  CORS_METHODS: (process.env.CORS_METHODS || 'GET,POST,PUT,DELETE,PATCH,OPTIONS').split(',').map(m => m.trim()),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOGGING_TYPE: process.env.LOGGING_TYPE || 'console', // 'console' or 'cloudwatch'
};

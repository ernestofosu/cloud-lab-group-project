/**
 * Storage helpers for local filesystem and S3-backed uploads (AWS SDK v3).
 */
const fs = require('fs');
const path = require('path');
const { GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  UPLOAD_DIR,
  STORAGE_TYPE,
  S3_BASE_URL,
  S3_UPLOADS_PREFIX,
} = require('../config/constants');
const { getS3Client, isS3Enabled, UPLOAD_BUCKET } = require('../config/s3');

const PRESIGN_EXPIRY_SECONDS = 900;

function normalizeS3Key(input) {
  if (!input) return null;

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch (_) {
      return input.replace(/^\/+/, '');
    }
  }

  return input.replace(/^\/+/, '');
}

/** Prefix a key with S3_UPLOADS_PREFIX unless it already carries it. */
function withUploadsPrefix(key) {
  return key.startsWith(S3_UPLOADS_PREFIX) ? key : `${S3_UPLOADS_PREFIX}${key}`;
}

/** Get the public URL for a stored file */
function storageUrl(key) {
  if (!key) return null;

  if (STORAGE_TYPE === 's3') {
    const safeKey = normalizeS3Key(key);
    if (!safeKey) return null;
    return `${S3_BASE_URL || ''}/${withUploadsPrefix(safeKey)}`.replace(/([^:]\/)\/{2,}/g, '$1/');
  }

  // Local storage: stored paths already start with "/uploads/", so strip the
  // prefix before re-adding it rather than producing "/uploads//uploads/...".
  const relative = normalizeS3Key(key);
  if (!relative) return null;
  return '/uploads/' + relative.replace(/^uploads\//, '');
}

/** Create a temporary read URL for a private S3 object. */
async function storageReadUrl(key) {
  if (!key) return null;

  if (STORAGE_TYPE === 's3' && isS3Enabled()) {
    const objectKey = normalizeS3Key(key);
    if (!objectKey) return null;

    try {
      return await getSignedUrl(
        getS3Client(),
        new GetObjectCommand({ Bucket: UPLOAD_BUCKET, Key: withUploadsPrefix(objectKey) }),
        { expiresIn: PRESIGN_EXPIRY_SECONDS }
      );
    } catch (err) {
      console.error('S3 presign failed:', err.message);
      return storageUrl(key);
    }
  }

  return storageUrl(key);
}

/** Delete a stored file */
async function storageDelete(key) {
  if (!key) return;

  if (STORAGE_TYPE === 's3' && isS3Enabled()) {
    const s3Key = normalizeS3Key(key);
    if (s3Key) {
      try {
        await getS3Client().send(new DeleteObjectCommand({
          Bucket: UPLOAD_BUCKET,
          Key: withUploadsPrefix(s3Key),
        }));
      } catch (err) {
        // Never fail the request because cleanup of an old object failed.
        console.warn('S3 delete failed:', err.message);
      }
    }
    return;
  }

  const normalized = normalizeS3Key(key);
  if (!normalized) return;
  const fileName = normalized.replace(/^uploads\//, '');
  const fullPath = path.join(UPLOAD_DIR, fileName);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

module.exports = { storageUrl, storageReadUrl, storageDelete };

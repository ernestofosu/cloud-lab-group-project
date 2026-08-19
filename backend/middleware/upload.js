/**
 * Multer file upload configuration — local disk or AWS S3 (SDK v3).
 */
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const {
  UPLOAD_DIR,
  MAX_UPLOAD_BYTES,
  MAX_COVER_BYTES,
  ALLOWED_RESOURCE_MIMES,
  ALLOWED_IMAGE_MIMES,
  STORAGE_TYPE,
  S3_BASE_URL,
  S3_UPLOADS_PREFIX,
} = require('../config/constants');
const { getS3Client, isS3Enabled, UPLOAD_BUCKET } = require('../config/s3');

function safeFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  return crypto.randomBytes(16).toString('hex') + ext;
}

function folderFor(fieldname) {
  return fieldname === 'cover_image' ? 'covers' : 'books';
}

// ========== Local Storage Configuration ==========
function diskStorageIn(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = subdir === null ? path.join(UPLOAD_DIR, folderFor(file.fieldname)) : path.join(UPLOAD_DIR, subdir);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, safeFilename(file.originalname)),
  });
}

// ========== S3 Storage Configuration (multer-s3 v3 + SDK v3) ==========
// No `acl` option: buckets created with the modern default have ACLs disabled
// and would reject the request with AccessControlListNotSupported. Object
// privacy is controlled by the bucket policy / Block Public Access instead.
function s3StorageWithKey(keyBuilder) {
  return multerS3({
    s3: getS3Client(),
    bucket: UPLOAD_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => cb(null, keyBuilder(file)),
  });
}

const useS3 = STORAGE_TYPE === 's3' && isS3Enabled();

const resourceStorage = useS3
  ? s3StorageWithKey((file) => `${S3_UPLOADS_PREFIX}${folderFor(file.fieldname)}/${safeFilename(file.originalname)}`)
  : diskStorageIn(null);

const profileStorage = useS3
  ? s3StorageWithKey((file) => `${S3_UPLOADS_PREFIX}profiles/${safeFilename(file.originalname)}`)
  : diskStorageIn('profiles');

// ========== File Filters ==========
function resourceFilter(req, file, cb) {
  if (file.fieldname === 'resource_file') {
    if (!ALLOWED_RESOURCE_MIMES[file.mimetype]) {
      return cb(new Error('Only PDF files are allowed for resources.'), false);
    }
  } else if (file.fieldname === 'cover_image') {
    if (!ALLOWED_IMAGE_MIMES[file.mimetype]) {
      return cb(new Error('Only JPEG, PNG, and WebP images are allowed for covers.'), false);
    }
  }
  cb(null, true);
}

function imageFilter(req, file, cb) {
  if (!ALLOWED_IMAGE_MIMES[file.mimetype]) {
    return cb(new Error('Only JPEG, PNG, and WebP images are allowed.'), false);
  }
  cb(null, true);
}

// ========== Multer Instances ==========
const uploadResource = multer({
  storage: resourceStorage,
  fileFilter: resourceFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES },
}).fields([
  { name: 'resource_file', maxCount: 1 },
  { name: 'cover_image', maxCount: 1 },
]);

const uploadProfilePhoto = multer({
  storage: profileStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_COVER_BYTES },
}).single('profile_photo');

// ========== File URL Helper ==========
/** Public URL for an uploaded file: an S3 object URL, or a local API path. */
function getFileUrl(fileName, fileType = 'books') {
  if (useS3) {
    return `${S3_BASE_URL || ''}/${S3_UPLOADS_PREFIX}${fileType}/${fileName}`;
  }
  return `/uploads/${fileType}/${fileName}`;
}

module.exports = { uploadResource, uploadProfilePhoto, safeFilename, getFileUrl };

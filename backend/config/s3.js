/**
 * AWS S3 client (SDK v3).
 *
 * Created lazily so module load order does not matter: `middleware/upload.js`
 * and `utils/storage.js` can ask for the client at request time rather than
 * depending on `server.js` having already assigned a global.
 *
 * Credentials come from AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY when both are
 * set; otherwise the default provider chain is used, which picks up the EC2
 * instance IAM role. Preferring the instance role is the safer deployment.
 */
const { S3Client } = require('@aws-sdk/client-s3');
const {
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET,
  AWS_S3_UPLOADS_BUCKET,
  STORAGE_TYPE,
} = require('./constants');

// Uploads should live in their own private bucket. Fall back to AWS_S3_BUCKET
// only when AWS_S3_UPLOADS_BUCKET is unset.
const UPLOAD_BUCKET = AWS_S3_UPLOADS_BUCKET || AWS_S3_BUCKET;

const PLACEHOLDER = /your_iam|enter_|example|placeholder/i;

const hasExplicitKeys = Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
const hasPartialKeys = Boolean(AWS_ACCESS_KEY_ID || AWS_SECRET_ACCESS_KEY) && !hasExplicitKeys;
const hasPlaceholderKeys = hasExplicitKeys
  && (PLACEHOLDER.test(AWS_ACCESS_KEY_ID) || PLACEHOLDER.test(AWS_SECRET_ACCESS_KEY));

let client = null;
let disabledReason = null;

if (STORAGE_TYPE !== 's3') {
  disabledReason = `STORAGE_TYPE is "${STORAGE_TYPE}" — using local disk storage`;
} else if (hasPartialKeys) {
  disabledReason = 'S3 needs both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or neither, to use the EC2 instance role)';
} else if (hasPlaceholderKeys) {
  disabledReason = 'AWS credentials still contain placeholder values';
} else if (!UPLOAD_BUCKET) {
  disabledReason = 'AWS_S3_UPLOADS_BUCKET (or AWS_S3_BUCKET) is not set';
}

/** The shared S3Client, or null when S3 storage is not usable. */
function getS3Client() {
  if (disabledReason) return null;
  if (!client) {
    client = new S3Client({
      region: AWS_REGION,
      ...(hasExplicitKeys && {
        credentials: {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        },
      }),
    });
  }
  return client;
}

function isS3Enabled() {
  return !disabledReason;
}

/** Log the resolved storage configuration once at boot. */
function reportS3Status() {
  if (disabledReason) {
    const level = STORAGE_TYPE === 's3' ? console.warn : console.log;
    level(`${STORAGE_TYPE === 's3' ? '⚠' : '✓'} S3 disabled: ${disabledReason}`);
    return;
  }
  const source = hasExplicitKeys ? 'static credentials' : 'default credential chain (EC2 IAM role)';
  console.log(`✓ AWS S3 ready — bucket "${UPLOAD_BUCKET}" in ${AWS_REGION} via ${source}`);

  if (AWS_S3_BUCKET && AWS_S3_UPLOADS_BUCKET && AWS_S3_BUCKET === AWS_S3_UPLOADS_BUCKET) {
    console.warn(
      '⚠ AWS_S3_BUCKET and AWS_S3_UPLOADS_BUCKET are the same bucket. If that bucket ' +
      'is the public website bucket, uploaded files are publicly readable and the ' +
      'presigned-URL protection has no effect. Use a separate private bucket for uploads.'
    );
  }
}

async function closeS3Client() {
  if (client) {
    client.destroy();
    client = null;
  }
}

module.exports = { getS3Client, isS3Enabled, reportS3Status, closeS3Client, UPLOAD_BUCKET };

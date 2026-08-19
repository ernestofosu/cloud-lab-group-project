/**
 * GT Library — frontend runtime configuration
 * =============================================================================
 * THIS IS THE ONLY FILE YOU NEED TO EDIT WHEN THE BACKEND ADDRESS CHANGES.
 *
 * Set it to the backend's /api base URL, with no trailing slash:
 *
 *   EC2 public IP     http://13.60.13.49:3000/api
 *   Elastic IP        http://<elastic-ip>:3000/api
 *   Domain / ALB      https://api.your-domain.com/api
 *   Same-host testing leave as '' to use the page's own origin
 *
 * Notes
 *  - An EC2 public IP changes every time the instance is stopped and started.
 *    Attach an Elastic IP (or put an ALB/CloudFront in front) so this value
 *    stays valid; otherwise the site goes blank after every restart.
 *  - Whatever origin the frontend is served from must also be listed in
 *    ALLOWED_ORIGINS in backend/.env, or the browser will block the requests.
 *  - If the frontend is ever served over https://, the API must be https too —
 *    browsers block https pages from calling http endpoints (mixed content).
 *  - Re-upload this file to S3 after editing:
 *      aws s3 cp frontend/config.js s3://gt-library-main/config.js
 * =============================================================================
 */
window.GT_LIBRARY_API_URL = 'http://13.60.13.49:3000/api';

/**
 * Auth cookie options.
 *
 * The frontend is hosted in S3 and the API on EC2, so the auth cookie is a
 * cross-site cookie. Browsers only send those when `SameSite=None; Secure`,
 * and `Secure` cookies are silently discarded over plain HTTP — which is why
 * the cookie path is inert while the API is served on http://.
 *
 * The frontend's primary auth path is the `Authorization: Bearer` header, so
 * login works either way. Set COOKIE_SECURE=true once the API is behind HTTPS
 * (ALB/CloudFront) to make the cookie path work cross-site as well.
 */
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    // SameSite=None requires Secure; fall back to Lax on plain HTTP.
    sameSite: COOKIE_SECURE ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  };
}

/** clearCookie must match the attributes the cookie was set with. */
function clearCookieOptions() {
  const { maxAge, ...rest } = authCookieOptions();
  return rest;
}

module.exports = { COOKIE_SECURE, authCookieOptions, clearCookieOptions };

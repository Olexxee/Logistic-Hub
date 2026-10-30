# Authentication and Email Verification

## Implemented routes

- POST /api/v1/auth/register — creates a pending customer account and sends an email verification link.
- POST /api/v1/auth/verify-email — consumes a one-time, expiring verification token and activates the account.
- POST /api/v1/auth/login — checks the password and verified active account, creates a persistent refresh session, and returns a 15-minute bearer access token and sets a 30-day opaque refresh token in an HttpOnly cookie.
- POST /api/v1/auth/password/forgot — sends a reset link without disclosing whether an account exists.
- POST /api/v1/auth/password/reset — consumes a one-time, expiring reset token and changes the password.
- POST /api/v1/auth/refresh — atomically rotates the refresh token and issues a new access token.
- POST /api/v1/auth/logout — revokes the current authenticated session.
- POST /api/v1/auth/logout-all — revokes every active session for the authenticated account.
- GET /api/v1/auth/me — returns the current authenticated account.

## Security controls

- Passwords use Node.js scrypt with per-password random salts; plaintext passwords are never stored.
- Email-action tokens are cryptographically random, stored as SHA-256 hashes, purpose-scoped and expiring. Tokens are consumed atomically to prevent replay.
- Access tokens are HS256-signed with a server-side secret, carry the session ID, and expire after 15 minutes. Protected requests re-check account status and session revocation against the database.
- Refresh tokens are cryptographically random, stored only as SHA-256 hashes, expire after 30 days, and rotate atomically on use. Reuse of a rotated token is rejected.
- The refresh token is sent only through an HttpOnly cookie (`__Host-lh_refresh` in production); it is never included in JSON responses. The cookie is Secure, host-only, Path=/, SameSite=Lax in all environments.
- Login, refresh, and logout browser requests require an allowlisted Origin and the `X-Auth-CSRF: 1` custom header. CORS allows credentials only for configured `CORS_ORIGINS`.
- Password reset revokes every active session and consumes outstanding password-reset tokens.
- New accounts are always created as CUSTOMER/PENDING. Clients cannot choose roles or status.
- Error responses do not expose password hashes, token hashes, email-provider responses, or signing secrets.

## Required environment configuration

Set JWT_ACCESS_SECRET to at least 32 random characters in production. Set EMAIL_PROVIDER=resend, RESEND_API_KEY, and RESEND_FROM_EMAIL to enable registration and email delivery. The sender address must be verified in Resend. Configure APP_BASE_URL to the frontend origin that hosts the verification and password-reset pages. Set CORS_ORIGINS to the exact frontend origins (comma-separated, no wildcard) so credentialed cookie requests and Origin validation work.

## Limitations and next steps

Session revocation is checked on every authenticated request. Refresh rotation and authentication endpoints use persistent rate limiting. The production frontend and API must be deployed on compatible cookie domains. Prefer a same-site custom-domain arrangement (for example, app and api subdomains under one registrable domain) or a same-origin reverse proxy; browsers may block third-party cookies when the frontend and API remain on unrelated hosting domains. Remaining production work includes route-level integration coverage, account recovery delivery monitoring, and booking-specific authorization. Existing access tokens issued before session binding may remain valid until their 15-minute expiry. Driver onboarding, role elevation/admin workflows, phone verification, and booking-specific authorization are separate modules.

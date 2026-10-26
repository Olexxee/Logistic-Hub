# Authentication and Email Verification

## Implemented routes

- POST /api/v1/auth/register — creates a pending customer account and sends an email verification link.
- POST /api/v1/auth/verify-email — consumes a one-time, expiring verification token and activates the account.
- POST /api/v1/auth/login — checks the password and verified active account, then returns a 15-minute bearer access token.
- POST /api/v1/auth/password/forgot — sends a reset link without disclosing whether an account exists.
- POST /api/v1/auth/password/reset — consumes a one-time, expiring reset token and changes the password.
- GET /api/v1/auth/me — returns the current authenticated account.

## Security controls

- Passwords use Node.js scrypt with per-password random salts; plaintext passwords are never stored.
- Email-action tokens are cryptographically random, stored as SHA-256 hashes, purpose-scoped and expiring. Tokens are consumed atomically to prevent replay.
- Access tokens are HS256-signed with a server-side secret and expire after 15 minutes. Protected requests re-check account status against the database.
- New accounts are always created as CUSTOMER/PENDING. Clients cannot choose roles or status.
- Error responses do not expose password hashes, token hashes, email-provider responses, or signing secrets.

## Required environment configuration

Set JWT_ACCESS_SECRET to at least 32 random characters in production. Set EMAIL_PROVIDER=resend, RESEND_API_KEY, and RESEND_FROM_EMAIL to enable registration and email delivery. The sender address must be verified in Resend. Configure APP_BASE_URL to the frontend origin that hosts the verification and password-reset pages.

## Limitations and next steps

This first auth increment uses short-lived access tokens without refresh tokens or server-side session revocation; access tokens may remain valid for up to 15 minutes after a password reset or account-state change. Add refresh-session rotation/revocation and persistent rate limiting before treating auth as production complete. Driver onboarding, role elevation/admin workflows, phone verification, and booking-specific authorization are separate modules.

# GEO-06 — Staging Admin bootstrap

**Status:** Merged and deployed to the isolated staging backend; email-control attestation hardening in review.  
**Scope:** One-time first Admin provisioning in the isolated Logistic Hub staging database.  
**Production impact:** None; production remains untouched.

## Why a bootstrap script

Public registration always assigns the `CUSTOMER` role. It must not accept a client-supplied role or provide an Admin registration route. The existing authentication flow requires both an ACTIVE account and a verified email before login.

The staging database contains the approved Nigeria geography seed and has no users. A one-time CLI is the smallest controlled provisioning mechanism.

## Guardrails

The script `scripts/bootstrap-staging-admin.js`:

- Requires `APP_STAGE=staging` and `NODE_ENV=development`.
- Accepts only PostgreSQL URLs targeting host `db.prisma.io` and database `postgres`, the verified dedicated staging connection target.
- Requires an explicit `--apply --confirm-staging-database=postgres --confirm-admin-email-control` before writes; default mode is dry-run.
- Requires one-off `STAGING_ADMIN_EMAIL`, `STAGING_ADMIN_FULL_NAME` and `STAGING_ADMIN_PASSWORD` values. The password must be 16–128 characters.
- Requires the operator to explicitly attest that they control the Admin email address. The one-time token is printed locally because staging email delivery is disabled; printing a token alone is not proof of mailbox ownership.
- Refuses to run if any user already exists. It does not promote, overwrite or reset existing accounts.
- Creates an `ADMIN` user in `PENDING` status, hashes the password with the existing authentication crypto, and creates a 24-hour email-verification token.
- Writes a system-attributed `OperationalAuditEvent` in the same Serializable transaction, including the operator's email-control attestation.

The token must be submitted to `POST /api/v1/auth/verify-email` on the staging API. The normal auth flow then activates the account. Login still requires the normal trusted-browser CORS/CSRF checks and valid staging JWT configuration.

## Local execution

Create a temporary `.env.staging.local` file in the backend repository root. It must be ignored by Git and contain the rotated staging connection URL plus:

```env
APP_STAGE=staging
NODE_ENV=development
STAGING_ADMIN_EMAIL=your-controlled-staging-admin-email@example.com
STAGING_ADMIN_FULL_NAME=Staging Administrator
STAGING_ADMIN_PASSWORD=use-a-unique-password-of-at-least-16-characters
```

Run a dry-run first:

```powershell
npx --yes --package=node@22 node --env-file=.env.staging.local scripts/bootstrap-staging-admin.js
```

Only after reviewing the reported staging target and confirming the users table is empty, run:

```powershell
npx --yes --package=node@22 node --env-file=.env.staging.local scripts/bootstrap-staging-admin.js --apply --confirm-staging-database=postgres --confirm-admin-email-control
```

The final flag is an explicit operator attestation that the configured email address is under your control. The verification token is emitted once to the local terminal; do not share it, commit it or retain it in transcripts. Submit it to the staging API verification endpoint before attempting sign-in.

Remove the temporary environment file after use. Never add these one-off values to Render's persistent service environment or commit them to the repository.

## Acceptance checks

- Dry-run produces no writes.
- Production stage/runtime mode, unexpected host/database, missing credentials, or missing confirmations fail before writes.
- Existing users cause the script to refuse provisioning.
- Successful creation is transactional: Admin account, hashed verification token and audit event are committed together.
- The user remains PENDING until the existing verification endpoint consumes the token.
- Re-running after the first Admin exists fails closed.

## Current limitations

This bootstrap does not provision a staging frontend, configure CORS, or enable email delivery. Those are separate staging acceptance tasks. It does not create or activate service zones and does not touch production.

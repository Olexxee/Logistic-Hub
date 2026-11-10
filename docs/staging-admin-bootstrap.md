# GEO-06 — Staging Admin bootstrap

**Status:** Implementation proposal in review  
**Scope:** One-time first Admin provisioning in the isolated Logistic Hub staging database  
**Production impact:** None intended; production must remain untouched.

## Why a bootstrap script

Public registration always assigns the `CUSTOMER` role. It must not accept a client-supplied role or provide an Admin registration route. The existing authentication flow requires both an ACTIVE account and a verified email before login.

The staging database currently contains the approved Nigeria geography seed and has no users. A one-time CLI is therefore the smallest controlled provisioning mechanism.

## Guardrails

The script `scripts/bootstrap-staging-admin.js`:

- Requires `APP_STAGE=staging` and `NODE_ENV=development`.
- Accepts only PostgreSQL URLs targeting host `db.prisma.io` and database `postgres`, the verified dedicated staging connection target.
- Requires an explicit `--apply --confirm-staging-database=postgres` before writes; default mode is dry-run.
- Requires one-off `STAGING_ADMIN_EMAIL`, `STAGING_ADMIN_FULL_NAME` and `STAGING_ADMIN_PASSWORD` values. The password must be 16–128 characters.
- Refuses to run if any user already exists. It does not promote, overwrite or reset an existing account.
- Creates an `ADMIN` user in `PENDING` status, hashes the password with the existing authentication crypto, and creates a 24-hour email-verification token.
- Writes a system-attributed `OperationalAuditEvent` in the same Serializable transaction.
- Prints the one-time verification token once to the local terminal because staging email delivery is currently disabled. Do not paste it into chat, commit it, or retain it in shell transcripts.

The token must be submitted to `POST /api/v1/auth/verify-email` on the staging API. The normal auth flow then activates the account; login still requires the normal trusted-browser CORS/CSRF checks and valid staging JWT configuration.

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
node --env-file=.env.staging.local scripts/bootstrap-staging-admin.js
```

Only after reviewing the reported staging target and confirming that the users table is empty:

```powershell
node --env-file=.env.staging.local scripts/bootstrap-staging-admin.js --apply --confirm-staging-database=postgres
```

After the command completes, verify the email using the returned token against the staging API. Do not use the production API URL.

Remove the temporary environment file after use. Never add these one-off values to Render's persistent service environment or commit them to the repository.

## Acceptance checks

- Dry-run produces no writes.
- Production stage, production runtime mode, unexpected host, unexpected database name, missing credentials, and incorrect confirmation all fail before writes.
- Existing users cause the script to refuse provisioning.
- Successful creation is transactional: Admin account, hashed verification token and audit event are committed together.
- The user remains PENDING until the existing verification endpoint consumes the token.
- Re-running after the first Admin exists fails closed.

## Current limitations

This bootstrap does not provision a staging frontend, configure CORS, enable email delivery, or bypass browser CSRF protections. Those are separate staging acceptance tasks. It does not create or activate service zones and does not touch production.

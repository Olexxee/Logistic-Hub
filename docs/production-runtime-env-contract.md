# Production Runtime and Environment Contract

This document is the deployment checklist for the Logistic Hub API. It describes configuration requirements; it does not attest that a particular Render service currently contains those values.

## Runtime

- Supported production runtime: Node.js 22.x.
- `package.json` declares `22.x` and `.nvmrc` selects the same major line.
- Deploy the API, outbox worker, driver-assignment expiry worker and integration webhook worker in the existing single Render Web Service. Do not create a separate worker service for the current free-plan deployment model.

## Required production configuration

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection URL for the production database |
| `JWT_ACCESS_SECRET` | At least 32 characters; use a high-entropy secret |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | Valid Resend API key |
| `RESEND_FROM_EMAIL` | Verified sender address |
| `OUTBOX_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes |
| `CORS_ORIGINS` | Comma-separated exact frontend origins; HTTPS in production; no wildcard, path, query, or credentials |
| `APP_STAGE` | Explicitly set to `production`; if omitted, runtime derives production from `NODE_ENV` |
| `DRIVER_KYC_MODE` | `STRICT`; if omitted, runtime derives strict mode for production |

`CORS_ORIGINS` may be empty for a backend that intentionally serves no browser-origin requests; in that case browser CORS access is denied. Configure the deployed frontend origin before expecting browser access.

## Conditional configuration

- Google Maps: set `MAPS_PROVIDER=google` and `GOOGLE_MAPS_API_KEY` only when the server-side Google Places/geocoding/routes integration is intended to be enabled. Polygon containment and service-zone resolution do not require Google Maps.
- Partner webhook-secret encryption: set `WEBHOOK_SECRET_ENCRYPTION_KEY` to a separate base64 32-byte key before creating or delivering partner webhooks that require stored encrypted secrets.
- Cloudinary: configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` together.
- Legacy Firebase evidence reads: configure both `FIREBASE_SERVICE_ACCOUNT_BASE64` and `FIREBASE_STORAGE_BUCKET` only if legacy evidence retrieval is still required.

## Financial safety gates

- `PAYMENTS_ENABLED` remains `false`. The backend deliberately blocks enabling it through environment configuration.
- `REFUNDS_ENABLED` remains `false` unless provider refund submission is separately reviewed and explicitly approved.
- Never add live payment credentials merely to make startup pass.

## Validation behavior

- Configured CORS entries are parsed as origins. Invalid URLs, paths, embedded credentials, query strings, fragments and non-HTTPS production origins are rejected at startup.
- An empty CORS list does not open access; it disables cross-origin browser access.
- Optional provider credentials are validated when their provider is enabled.
- Do not paste secret values into issues, pull requests, chat, or documentation.

## Production verification record

The repository cannot prove which environment variables are currently stored in Render. Verify the variable **names** in the Render production service Environment page and compare them with this contract. Keep secret values in Render; do not export or share them.

After a deploy, verify:
1. Runtime log reports Node 22.x.
2. Server starts and PostgreSQL connectivity succeeds.
3. The outbox, assignment-expiry and webhook workers report their expected enabled/disabled states.
4. `/api/v1/health/live` and `/api/v1/health/ready` return the expected liveness/readiness status.
5. Browser requests from the exact deployed frontend origin pass CORS preflight and authenticated refresh-cookie flows.

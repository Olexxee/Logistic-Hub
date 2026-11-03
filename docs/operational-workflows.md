# Operational workflows and rollout gates

This document describes operational workflows implemented on the repository's default branch. It is implementation guidance, not evidence that production environment configuration or a production migration has been applied. Payment initialization remains hard-disabled.

## Authentication sessions

- `POST /api/v1/auth/login` issues a short-lived bearer access token in JSON and sets the opaque refresh token in an HttpOnly cookie.
- `POST /api/v1/auth/refresh` is the canonical refresh endpoint. It reads the refresh cookie, rotates the persisted session token and sets the replacement cookie. The refresh token is never returned in JSON.
- `POST /api/v1/auth/logout` revokes the authenticated persisted session and clears the refresh cookie.
- `POST /api/v1/auth/logout-all` revokes every session for the authenticated user and clears the current refresh cookie.
- `POST /api/v1/auth/sessions/refresh` is retired and returns 410. Do not use the old `/auth/sessions/*` routes.
- Browser login, refresh and logout requests require an allowlisted `Origin`, the `X-Auth-CSRF: 1` header and credentialed requests. Production refresh cookies are Secure and HttpOnly.
- Access tokens must be bound to a persisted session. Every authenticated request checks that the session belongs to the account and is not revoked or expired; the database account role is authoritative.
- Password reset revokes active sessions. Auth mutation endpoints use database-backed rate limiting.

Refresh tokens are opaque random values; only SHA-256 hashes are persisted. Never log or expose refresh credentials.

## Assignment lifecycle

An assignment may enter `ACCEPTED` only when the backend reports it as eligible. Payment initialization is currently disabled; do not infer payment or assignment eligibility from a browser redirect or client-side state.

1. Driver: `POST /api/v1/assignments/:assignmentId/arrived`
2. Booking owner: `POST /api/v1/assignments/:assignmentId/verification-codes` with `{ "action": "PICKUP" }`
3. Driver: `POST /api/v1/assignments/:assignmentId/verify` with the pickup code
4. Driver: `POST /api/v1/assignments/:assignmentId/start`
5. Driver: `POST /api/v1/assignments/:assignmentId/destination-arrived`
6. Booking owner issues a `DELIVERY` code; driver submits it to `/verify`.

Codes are six digits, stored hashed, expire after ten minutes, and are single-use. Do not log codes or return them to driver clients. The booking owner can poll `GET /api/v1/assignments/:assignmentId/location` while the assignment is active; only locations recorded within the last two minutes are returned.

## Payments and split settlement

- `POST /api/v1/payments/initialize` expects an `Idempotency-Key` header and `{ "bookingType": "PARCEL" | "RIDE", "bookingId": "..." }`.
- The assigned driver must have an active Paystack subaccount configured in `DriverSettlementAccount.externalAccountRef`.
- Paystack initialization uses the driver subaccount and a fixed platform allocation. The webhook signature is verified against the raw request bytes, then the transaction is verified directly with Paystack before the booking is marked paid.
- Payment settlement records the platform's split allocation as a balanced double-entry journal. Driver subaccount settlement is tracked separately; the platform must not send a second transfer for the same fare.

**Hard gate:** `PAYMENTS_ENABLED=true` is rejected by environment validation, and the exported configuration forces payments off. `POST /api/v1/payments/initialize` and the Paystack webhook are not available for new payment collection. Do not remove this gate or enable live payments without explicit owner approval and a reviewed staging/live payment test plan.

## Refunds, payouts and reconciliation

- Customers request a refund via `POST /api/v1/finance/refund-requests`, using an `Idempotency-Key`.
- `ADMIN`/`SUPPORT` can review requests at `/api/v1/finance/admin/refunds`. Provider refund submission is independently gated by `REFUNDS_ENABLED` (false by default) and requires the configured Paystack secret; do not assume the payment-initialization flag also controls refunds.
- Completion creates an idempotent driver settlement record. Since the Paystack subaccount split is not escrow, the settlement is reconciled against provider settlement rather than triggering a second driver transfer.
- `ADMIN`/`SUPPORT` can list `/api/v1/finance/admin/payouts` and confirm an observed provider settlement at `/api/v1/finance/admin/payouts/:payoutId/confirm-settlement`.
- `ADMIN` can inspect `GET /api/v1/finance/admin/reconciliation` for unbalanced journals, successful payments without ledger entries, pending driver settlements and refunds requiring attention.

## Cancellation and support

- `POST /api/v1/cancellations` cancels unpaid bookings, withdraws offers and releases reserved drivers.
- Paid bookings move to `CANCELLATION_PENDING` and create a high-priority support ticket. No refund is issued automatically.
- Customer tickets: `POST /api/v1/support/tickets` and `GET /api/v1/support/tickets/mine`.
- Support/admin queue: `GET /api/v1/support/admin/tickets`; updates use `PATCH /api/v1/support/admin/tickets/:ticketId`.

## Database rollout

Migration files are part of the repository's versioned database history. CI validates migration history and applies migrations only to disposable PostgreSQL databases. A successful CI migration check does not mean a production database has been migrated. Do not run `prisma migrate deploy` against a production database without explicit repository-owner approval and a reviewed rollout plan.

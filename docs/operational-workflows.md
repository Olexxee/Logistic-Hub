# Operational workflows and rollout gates

This document describes the new endpoints on `feat/secure-lifecycle-payments`. They are not deployed by this branch.

## Authentication sessions

- `POST /api/v1/auth/sessions/refresh` — rotates a refresh token; the previous token becomes unusable.
- `POST /api/v1/auth/sessions/revoke` — revokes one refresh token.
- `POST /api/v1/auth/sessions/revoke-all` — revokes every refresh session for the authenticated user.
- Password reset revokes all active refresh sessions.
- Auth mutation endpoints and payment initialization use database-backed rate-limit buckets. Client IP handling trusts one reverse proxy hop; adjust `trust proxy` if deployment topology differs.

Refresh tokens are opaque random values; only SHA-256 hashes are persisted. Access tokens remain short-lived signed bearer tokens.

## Assignment lifecycle

After payment settlement, the driver assignment moves to `ACCEPTED`.

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

**Hard gate:** `PAYMENTS_ENABLED=true` is rejected by environment validation, and the exported configuration forces payments off. Do not remove this gate or enable live payments without explicit owner approval and a reviewed staging/live payment test plan.

## Refunds, payouts and reconciliation

- Customers request a refund via `POST /api/v1/finance/refund-requests`, using an `Idempotency-Key`.
- `ADMIN`/`SUPPORT` can review requests at `/api/v1/finance/admin/refunds`. Actual Paystack refund submission remains blocked while payments are disabled.
- Completion creates an idempotent driver settlement record. Since the Paystack subaccount split is not escrow, the settlement is reconciled against provider settlement rather than triggering a second driver transfer.
- `ADMIN`/`SUPPORT` can list `/api/v1/finance/admin/payouts` and confirm an observed provider settlement at `/api/v1/finance/admin/payouts/:payoutId/confirm-settlement`.
- `ADMIN` can inspect `GET /api/v1/finance/admin/reconciliation` for unbalanced journals, successful payments without ledger entries, pending driver settlements and refunds requiring attention.

## Cancellation and support

- `POST /api/v1/cancellations` cancels unpaid bookings, withdraws offers and releases reserved drivers.
- Paid bookings move to `CANCELLATION_PENDING` and create a high-priority support ticket. No refund is issued automatically.
- Customer tickets: `POST /api/v1/support/tickets` and `GET /api/v1/support/tickets/mine`.
- Support/admin queue: `GET /api/v1/support/admin/tickets`; updates use `PATCH /api/v1/support/admin/tickets/:ticketId`.

## Database rollout

The additive migration `20261026170000_security_operations` is part of the branch. CI applies it only to disposable PostgreSQL. Do not run `prisma migrate deploy` against the user's database until the PR has passed review and the owner approves the migration rollout.

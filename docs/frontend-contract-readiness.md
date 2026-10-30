# Frontend Contract Readiness

**Audit baseline:** `main` at the 30 October 2026 backend state, including Priority 6 partner custody and settlement work.

**Decision:** The backend now exposes the discovery APIs needed to build the driver assignment dashboard, administrative user/quote queues and partner/hub capability views. Full route-to-OpenAPI parity validation remains the release gate; payment initiation remains disabled by configuration.

## Confirmed mounted contract areas

The following are mounted by `src/app.js` and have route implementations:

| Area | Current API surface | Frontend implication |
|---|---|---|
| Auth | `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/me` | Implement account flows using JSON token responses. Refresh tokens are not httpOnly cookies. |
| Geography/maps | `/service-zones`, `/maps/geocode`, `/maps/routes` | Maps calls require authenticated access. Booking needs valid coordinates and active service zones. |
| Customer and admin parcels | `GET /parcel-bookings`, `/parcel-bookings/:bookingId`, `/parcel-bookings/:bookingId/delivery-legs` | Customers receive their own bookings; ADMIN/SUPPORT receive the operational list with pagination and status filtering. |
| Local driver dispatch | `/parcel-bookings/:bookingId/request-matching`, `/parcel-bookings/:bookingId/offers`, `/driver/offers`, `/driver/offers/:offerId/propose-fare`, `/parcel-bookings/:bookingId/accept-fare` | Local fare negotiation is implemented. Fare acceptance is not the same as payment confirmation. |
| Partner pricing | `/admin/parcel-bookings/:bookingId/quotes`, `/parcel-bookings/:bookingId/quotes`, quote accept/reject routes, partner rate-card administration | Partner quotes are separate from local driver fare offers. Use the accepted quote snapshot and multi-leg plan returned by the API. |
| Delivery-leg dispatch | `/delivery-legs/:legId/request-matching`, `/driver/delivery-leg-offers`, driver propose-fare, customer list/accept fare routes | Delivery-leg driver matching is implemented; do not assume it exposes the driver's active assignment dashboard. |
| Driver profile | `/drivers/me`, `/drivers/onboarding`, `/drivers/availability`, `/drivers/location` | Onboarding and availability are available. Admin verification and vehicle review routes are separate. |
| Driver assignment execution | `GET /driver/assignments/mine`, `/assignments/:assignmentId/arrived`, `/start`, `/destination-arrived`, `/verification-codes`, `/verify`, `/location` | Drivers can now discover their active assignments before invoking execution actions. |
| Partner execution | `GET /partner/assignments`, `GET /partner/memberships/mine`, accept/start, admin partner members and delivery-leg assignment | Partner members can discover all active/inactive memberships and their operational partner summaries. |
| Custody | `GET /custody/handovers/mine`, `GET /hub-operator/memberships/mine`, create handover, handover decision, admin hub operator membership, admin phone-verification record | Hub operators can discover memberships even when no handovers exist. No recipient SMS OTP is implemented. |
| Operational exceptions | `/admin/operational-cases` list/update | Admin case triage and resolution can be integrated. |
| Partner settlement | `/partner/payables`, admin payables, adjustments, settlement batches, approval and reconciliation | Internal payable/reconciliation workflow only; no external transfer is performed by these routes. |
| Finance review | `/finance/refund-requests`, admin refund review/list, admin payout list/settlement confirmation, reconciliation, `GET /payments/:paymentAttemptId` | Finance operations are mounted under `/finance`; payment-attempt reads are owner/authorized-operator scoped and exclude provider secrets. |

## Frontend-blocking gaps

These are genuine API discovery/operations gaps, not UI tasks to work around with guessed IDs or scraping unrelated resources.

| Gap | Why it blocks the client | Required backend contract |
|---|---|---|
| Driver active assignment discovery | `GET /driver/offers` returns offers, not the driver's accepted/active assignments. Driver execution routes require `assignmentId`. | Authenticated driver endpoint returning active assignments with booking/leg summary, assignment state and allowed next actions. |
| Admin user search | Resolved in this PR. | `GET /admin/users` is admin-only, paginated and returns safe identity, role, account and verification fields. |
| Admin parcel booking queue | Resolved in the existing parcel-booking service. | `GET /parcel-bookings` returns all bookings to ADMIN/SUPPORT, with page, limit and status filters. It does not yet support reference/date/zone filters. |
| Admin quote queue | Resolved in this PR. | `GET /admin/quotes` supports status, partner, booking and pagination filters. |
| Partner membership discovery | Resolved in this PR. | `GET /partner/memberships/mine` lists active and inactive memberships and safe partner summaries. |
| Hub-operator membership discovery | Resolved in this PR. | `GET /hub-operator/memberships/mine` lists active and inactive memberships and safe hub summaries. |
| Payment-attempt retrieval | Resolved in this PR. | `GET /payments/:paymentAttemptId` returns server-recorded payment state to the booking owner or ADMIN/SUPPORT, without provider references, provider payloads, or authorization URLs. |
| Payment activation | `POST /payments/initialize` and Paystack webhook route are mounted but runtime configuration forces payments off. | No frontend checkout activation until owner approval, provider configuration and end-to-end verification. |
| Refresh endpoint duplication | Both `POST /auth/refresh` and `POST /auth/sessions/refresh` are mounted. | Use `/auth/refresh` for new clients; retain the sessions path only as a deprecated compatibility alias until clients migrate. |

## Runtime configuration gates

- `PAYMENTS_ENABLED` is forced to `false` by `src/config/env.js`; setting the environment variable to true intentionally fails startup. Frontend must handle the disabled response and must not present checkout as available.
- `MAPS_PROVIDER` defaults to `none`. Booking requires coordinates, so a working end-to-end booking environment must configure `MAPS_PROVIDER=google` and a valid server-side `GOOGLE_MAPS_API_KEY`.
- `CORS_ORIGINS` must explicitly include each deployed frontend origin (including preview origins that need API access). Current deployment values were not inspected in this repository audit.
- Email registration requires the configured email provider and valid sender. A local environment with `EMAIL_PROVIDER=none` cannot complete registration email delivery.

## Contract corrections in the discovery-endpoints PR

- Added `GET /driver/assignments/mine` with page-based pagination and safe booking/leg summaries.
- Added `GET /admin/users` for admin-only user discovery, with safe fields and bounded filters.
- Added `GET /admin/quotes` for the cross-booking quote queue with status, partner and booking filters.
- Added `GET /partner/memberships/mine` and `GET /hub-operator/memberships/mine`, including inactive memberships.
- Implemented owner/authorized-operator-scoped `GET /payments/:paymentAttemptId`; response excludes provider references, raw payloads, authorization URLs and settlement details.
- Confirmed `GET /parcel-bookings` already serves an admin/support operational list; the query currently supports status and pagination, not reference/date/zone filters.
- OpenAPI now describes these operations. A route-to-spec parity validator and endpoint integration tests remain part of this PR's completion criteria.

- Assignment route paths now match the Express router: `verification-codes`, `arrived`, `verify`, `start`, `destination-arrived`, and `location`.
- Assignment verification schemas now specify `action` and a six-digit code; issue-code requests specify `action`.
- Paystack webhook path is documented as `/payments/webhook/paystack`.
- Payment initialization, webhook processing and the unmounted legacy payment/refund/payout routes are marked `planned-disabled`; they are not advertised as operational payment flows.
- Mounted finance refund, payout-review and reconciliation routes are documented under `/finance`.
- The active cancellation route is documented as `POST /cancellations` with `bookingType`, `bookingId` and `reason`.
- The legacy refresh alias is documented as deprecated; `/auth/refresh` is canonical.
- Refund request idempotency keys are validated at the route boundary (8–128 characters), matching the documented contract.
- OpenAPI validation no longer compares the spec to a stale, hand-maintained list of implemented operations. It validates schema integrity, unique operation IDs, implementation-status metadata and declared idempotency requirements. It does not replace route-to-spec integration tests.

## Not included / safety constraints

- No production database migration or schema change.
- No live Paystack activation, payout transfer, or payment-provider configuration.
- No recipient SMS/OTP flow.
- No frontend implementation in this backend repository.
- No merge to `main` as part of this PR.

## Frontend sequencing recommendation

Build the API foundation and customer booking/quote flows against the confirmed contracts. Do not implement the driver assignment dashboard, admin operational queues, or membership administration UX until the missing discovery endpoints above are implemented and tested. Keep payment UI behind a server-driven feature gate and default it off.

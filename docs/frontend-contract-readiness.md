# Frontend Contract Readiness

**Audit baseline:** `main` at the 30 October 2026 backend state, including Priority 6 partner custody and settlement work.

**Decision:** The backend is not yet a complete frontend contract. Existing customer and partner workflows can be integrated against their mounted routes, but the operations console, driver assignment dashboard and some account/capability discovery flows need backend work before those screens can be considered contract-complete.

## Confirmed mounted contract areas

The following are mounted by `src/app.js` and have route implementations:

| Area | Current API surface | Frontend implication |
|---|---|---|
| Auth | `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/me` | Implement account flows using JSON token responses. Refresh tokens are not httpOnly cookies. |
| Geography/maps | `/service-zones`, `/maps/geocode`, `/maps/routes` | Maps calls require authenticated access. Booking needs valid coordinates and active service zones. |
| Customer parcels | `/parcel-bookings`, `/parcel-bookings/:bookingId`, `/parcel-bookings/:bookingId/delivery-legs` | Customer booking list, details and delivery-leg timeline can be integrated. |
| Local driver dispatch | `/parcel-bookings/:bookingId/request-matching`, `/parcel-bookings/:bookingId/offers`, `/driver/offers`, `/driver/offers/:offerId/propose-fare`, `/parcel-bookings/:bookingId/accept-fare` | Local fare negotiation is implemented. Fare acceptance is not the same as payment confirmation. |
| Partner pricing | `/admin/parcel-bookings/:bookingId/quotes`, `/parcel-bookings/:bookingId/quotes`, quote accept/reject routes, partner rate-card administration | Partner quotes are separate from local driver fare offers. Use the accepted quote snapshot and multi-leg plan returned by the API. |
| Delivery-leg dispatch | `/delivery-legs/:legId/request-matching`, `/driver/delivery-leg-offers`, driver propose-fare, customer list/accept fare routes | Delivery-leg driver matching is implemented; do not assume it exposes the driver's active assignment dashboard. |
| Driver profile | `/drivers/me`, `/drivers/onboarding`, `/drivers/availability`, `/drivers/location` | Onboarding and availability are available. Admin verification and vehicle review routes are separate. |
| Driver assignment execution | `/assignments/:assignmentId/arrived`, `/start`, `/destination-arrived`, `/verification-codes`, `/verify`, `/location` | Execution operations exist once the client has a valid assignment ID. |
| Partner execution | `/partner/assignments`, accept/start, admin partner members and delivery-leg assignment | A partner member can list their partner's assignments; membership listing itself is not exposed. |
| Custody | `/custody/handovers/mine`, create handover, handover decision, admin hub operator membership, admin phone-verification record | Custody handover workflows are available. No recipient SMS OTP is implemented. |
| Operational exceptions | `/admin/operational-cases` list/update | Admin case triage and resolution can be integrated. |
| Partner settlement | `/partner/payables`, admin payables, adjustments, settlement batches, approval and reconciliation | Internal payable/reconciliation workflow only; no external transfer is performed by these routes. |
| Finance review | `/finance/refund-requests`, admin refund review/list, admin payout list/settlement confirmation, reconciliation | These are mounted finance routes. They are not the old `/payments/refunds` or `/payments/payouts` paths. |

## Frontend-blocking gaps

These are genuine API discovery/operations gaps, not UI tasks to work around with guessed IDs or scraping unrelated resources.

| Gap | Why it blocks the client | Required backend contract |
|---|---|---|
| Driver active assignment discovery | `GET /driver/offers` returns offers, not the driver's accepted/active assignments. Driver execution routes require `assignmentId`. | Authenticated driver endpoint returning active assignments with booking/leg summary, assignment state and allowed next actions. |
| Admin user search | Adding partner members and hub operators currently requires a `userId` that the admin cannot discover through a dedicated search endpoint. | Admin-only paginated user search with safe fields, filters and role/status visibility. |
| Admin parcel booking queue | Customer booking list is owner-scoped; it is not an operational admin queue. | Admin/support booking list with status, reference, date, service-zone and exception filters. |
| Admin quote queue | Quote listing is scoped to one booking. There is no cross-booking admin quote queue. | Admin quote list with booking, partner, status, expiry and pagination filters. |
| Partner membership discovery | Assignment listing throws a membership error when no active membership exists and does not provide a general membership/capability view. | Authenticated membership/capability endpoint listing active partner memberships and roles. |
| Hub-operator membership discovery | `GET /custody/handovers/mine` only lists handovers and cannot reliably establish operator membership when there are no handovers. | Authenticated hub membership endpoint with hub identity, role and active status. |
| Payment-attempt retrieval | `GET /payments/{paymentAttemptId}` is a planned OpenAPI contract only; there is no matching mounted Express route. | Add an owner/authorized-operator-scoped payment-attempt read route, or keep the operation explicitly planned-disabled. |
| Payment activation | `POST /payments/initialize` and Paystack webhook route are mounted but runtime configuration forces payments off. | No frontend checkout activation until owner approval, provider configuration and end-to-end verification. |
| Refresh endpoint duplication | Both `POST /auth/refresh` and `POST /auth/sessions/refresh` are mounted. | Use `/auth/refresh` for new clients; retain the sessions path only as a deprecated compatibility alias until clients migrate. |

## Runtime configuration gates

- `PAYMENTS_ENABLED` is forced to `false` by `src/config/env.js`; setting the environment variable to true intentionally fails startup. Frontend must handle the disabled response and must not present checkout as available.
- `MAPS_PROVIDER` defaults to `none`. Booking requires coordinates, so a working end-to-end booking environment must configure `MAPS_PROVIDER=google` and a valid server-side `GOOGLE_MAPS_API_KEY`.
- `CORS_ORIGINS` must explicitly include each deployed frontend origin (including preview origins that need API access). Current deployment values were not inspected in this repository audit.
- Email registration requires the configured email provider and valid sender. A local environment with `EMAIL_PROVIDER=none` cannot complete registration email delivery.

## Contract corrections in this PR

This is a targeted correction of the high-impact mismatches identified in the audit, not proof that every OpenAPI operation has full route-to-spec parity. The existing OpenAPI document is large and still requires a systematic route-by-route comparison of every method, payload, response and authorization rule. Treat the gap register below as the current frontend gate; do not infer endpoint availability solely from an OpenAPI path.

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

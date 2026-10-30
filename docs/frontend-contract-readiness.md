# Frontend Contract Readiness

**Audit baseline:** `main` after Priority 6 and PR #30, plus the discovery and contract work in this branch.

**Decision:** The backend now exposes the discovery APIs required for customer, driver, partner and operations-console integration. The remaining release gate is automated route-to-OpenAPI parity and full CI. Payment initiation remains disabled.

## Confirmed API surfaces

| Area | Endpoints | Contract notes |
|---|---|---|
| Authentication | `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/me`, `/auth/sessions/*` | `/auth/refresh` is canonical; `/auth/sessions/refresh` is a deprecated compatibility alias. Tokens are returned in JSON, not httpOnly cookies. |
| Geography and maps | `/service-zones`, `/hub-points`, `/maps/geocode`, `/maps/routes`, `/geography/admin/*`, `/service-zones/admin/*` | Admin geography and service-zone CRUD/availability operations are documented. Maps require server-side provider configuration. Booking coordinates must map to active service zones. |
| Customer/admin parcel bookings | `GET/POST /parcel-bookings`, `GET /parcel-bookings/:bookingId`, `GET /parcel-bookings/:bookingId/delivery-legs` | Customers are owner-scoped. ADMIN/SUPPORT can list all bookings. Admin filters include status, payment status, reference, pickup/destination service zone and creation date range. Advanced filters are forbidden to customers. |
| Local driver dispatch | `/parcel-bookings/:bookingId/request-matching`, `/parcel-bookings/:bookingId/offers`, `/driver/offers`, `/driver/offers/:offerId/propose-fare`, `/parcel-bookings/:bookingId/accept-fare` | Fare proposals and customer acceptance are implemented. Fare acceptance does not mean payment has been collected. |
| Delivery-leg dispatch | `/delivery-legs/:legId/request-matching`, `/driver/delivery-leg-offers`, `/driver/delivery-leg-offers/:offerId/propose-fare`, `/parcel-bookings/:bookingId/delivery-legs/:legId/offers`, `/parcel-bookings/:bookingId/delivery-legs/:legId/accept-fare` | Separate from local booking-level driver dispatch. |
| Driver profile and execution | `/drivers/me`, `/drivers/onboarding`, `/drivers/availability`, `/drivers/location`, `GET /driver/assignments/mine`, `/assignments/:assignmentId/*` | Driver assignment discovery returns the authenticated driver's active assignments, booking summary, delivery-leg context and page-based pagination. |
| Partner pricing and execution | `/admin/transport-partners/*`, `/admin/partner-agreements/*`, `/admin/partner-rate-cards/*`, `/admin/parcel-bookings/:bookingId/quotes`, `/admin/quotes`, `/parcel-bookings/:bookingId/quotes*`, `/partner/assignments*`, `/partner/memberships/mine` | Admin quote queue supports status, partner, booking and pagination filters. Partner membership read includes active and inactive memberships. |
| Hub custody | `/custody/handovers*`, `/admin/hub-points/:hubPointId/operators*`, `/admin/users/:userId/phone-verification`, `/hub-operator/memberships/mine` | Hub membership discovery works even when the operator has no custody handovers. Recipient confirmation uses an active account with a verified matching phone; there is no SMS OTP flow. |
| Admin user directory | `GET /admin/users` | ADMIN-only, paginated search with role/status filters. Returns safe identity and verification fields only. |
| Operational exceptions | `/admin/operational-cases*` | Admin case triage and resolution lifecycle. |
| Partner settlement | `/partner/payables`, `/admin/partner-payables*`, `/admin/partner-payable-adjustments*`, `/admin/partner-settlement-batches*` | Internal payable, approval and reconciliation only. No external partner transfer is performed. |
| Finance and payment reads | `/finance/refund-requests`, `/finance/admin/*`, `GET /payments/:paymentAttemptId` | Payment attempt reads are owner/ADMIN/SUPPORT scoped and exclude provider references, raw payloads, authorization URLs and settlement details. Legacy unmounted `/payments/refunds` and `/payments/payouts` operations are not supported. |
| Support and cancellations | `/support/tickets*`, `POST /cancellations` | Cancellation uses the unified bookingType/bookingId/reason contract. Old support cancellation paths are not mounted. |

## Runtime and safety gates

- `PAYMENTS_ENABLED` is forced to `false` by `src/config/env.js`. `POST /payments/initialize` and the Paystack webhook return the disabled response until the project owner explicitly approves activation. Do not expose checkout as available.
- `GET /payments/:paymentAttemptId` is read-only and remains available independently of payment initialization being enabled.
- `MAPS_PROVIDER` defaults to `none`. A booking environment needs `MAPS_PROVIDER=google` and a valid server-side `GOOGLE_MAPS_API_KEY`.
- `CORS_ORIGINS` must include the deployed frontend origin and any preview origins that need API access. Deployment values were not inspected in this repository audit.
- Email registration requires the configured email provider and verified sender domain.
- Partner payable and settlement batch APIs are internal accounting/reconciliation workflows, not bank or Paystack transfer APIs.
- No production database migration, live payment activation, payout transfer, or recipient SMS/OTP flow is authorized by this work.

## Discovery APIs added in this branch

- `GET /driver/assignments/mine` — driver-owned active assignment list, page/limit pagination, safe parcel/ride and delivery-leg summaries.
- `GET /admin/users` — admin-only user search for partner-member and hub-operator assignment.
- `GET /admin/quotes` — admin/support cross-booking quote queue.
- `GET /partner/memberships/mine` — current user's active and inactive partner memberships.
- `GET /hub-operator/memberships/mine` — current user's active and inactive hub memberships.
- `GET /payments/:paymentAttemptId` — owner/authorized-operator scoped payment status, with no provider secrets.
- Extended `GET /parcel-bookings` — operational filters for admin/support while preserving customer ownership and rejecting admin-only filters for customer accounts.

## Contract validation

- `npm run api:validate` validates the OpenAPI document, unique operation IDs, implementation-status metadata, idempotency declarations and every mounted Express route against documented OpenAPI methods/paths, including geography and service-zone administration.
- Latest full CI validation passed on the discovery-contract branch: OpenAPI validation, mounted-route parity, Prisma schema/client generation, migration checks, disposable PostgreSQL schema-drift checks and API/PostgreSQL integrity tests.
- Deployment-specific `CORS_ORIGINS`, Google Maps credentials and email-provider configuration still require environment-level verification before end-to-end staging sign-off.
- Unit tests cover discovery read models, repository scoping/privacy and admin booking filters.
- CI must pass before this contract is considered ready for frontend implementation.

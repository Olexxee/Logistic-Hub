# Backend API Contracts

**Status:** The root metadata, health/readiness, active service zones, authentication/email verification, and provider-backed maps endpoints are implemented. Remaining routes in the OpenAPI document are planned contracts, not available endpoints.

The machine-readable contract is [`openapi.yaml`](openapi.yaml). Treat it as the source of truth for request/response shapes. Update the spec and contract tests together whenever a contract changes. Implemented operational endpoints are documented in [`operational-basics.md`](operational-basics.md).

## Stable API rules

- Prefix application endpoints with `/api/v1`.
- Use JSON request/response bodies and ISO-8601 UTC timestamps.
- Serialize every monetary amount as a decimal string containing integer minor units (NGN kobo). Never use floating-point currency or send naira decimal values to payment endpoints.
- Use `Idempotency-Key` for state-changing operations that clients may retry. The same key and same logical request must return the same result; reusing a key for a different request must return a conflict.
- Never accept client-authoritative booking/payment status, assignment ownership, pricing snapshots, payment amount, provider reference, settlement destination, split configuration, verification state or ledger entries.
- Keep the agreed driver fare, fixed platform connection fee and other disclosed charges separate in the internal price snapshot.
- The sender must explicitly accept one unexpired driver fare proposal before a payment attempt can be initialized.
- Validate both pickup and destination service-zone IDs against current service availability. A state, LGA or zone existing in the reference database does not mean that service is enabled there.
- Maps credentials remain server-side. Normalize provider responses before returning them.
- Payment endpoints remain disabled until the project owner explicitly approves implementation and activation.

## Response envelope

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be processed.",
    "details": []
  }
}
```

Error responses must not expose stack traces, provider secrets, raw database errors or sensitive personal data. Validation errors may include safe field paths and messages.

## Current implementation status

| Method | Path | Status | Purpose |
|---|---|---|---|
| GET | `/` | Implemented | API metadata |
| GET | `/api/v1/health` | Implemented | Process health only |
| GET | `/api/v1/health/ready` | Implemented | Database readiness check; returns 503 when PostgreSQL is unavailable |
| GET | `/api/v1/service-zones` | Implemented | Active zones and currently available service types |
| POST | `/api/v1/auth/register` | Implemented | Create a pending customer account and send verification email |
| POST | `/api/v1/auth/verify-email` | Implemented | Consume one-time verification token |
| POST | `/api/v1/auth/login` | Implemented | Authenticate an active verified account |
| POST | `/api/v1/auth/password/forgot` | Implemented | Request password reset without account enumeration |
| POST | `/api/v1/auth/password/reset` | Implemented | Consume one-time password reset token |
| GET | `/api/v1/auth/me` | Implemented | Read authenticated account profile |
| POST | `/api/v1/maps/geocode` | Implemented | Geocode address through configured provider; authenticated |
| POST | `/api/v1/maps/routes` | Implemented | Compute normalized route; authenticated |
| POST | `/api/v1/parcel-bookings` | Implemented | Create an idempotent draft parcel booking with a fixed connection-fee snapshot |
| GET | `/api/v1/parcel-bookings/{bookingId}` | Implemented | Read owner-visible booking details and lifecycle state |
| POST | `/api/v1/parcel-bookings/{bookingId}/request-matching` | Implemented | Fan out offers to verified drivers covering both service zones |
| GET | `/api/v1/parcel-bookings/{bookingId}/offers` | Implemented | List driver fare proposals for the booking sender |
| GET | `/api/v1/driver/offers` | Implemented | List active offers for an eligible driver |
| POST | `/api/v1/driver/offers/{offerId}/propose-fare` | Implemented | Driver submits one idempotent fare proposal |
| POST | `/api/v1/parcel-bookings/{bookingId}/accept-fare` | Implemented | Sender accepts a fare and reserves the driver pending payment |
| POST | `/api/v1/payments` | Planned and disabled | Initialize payment after fare acceptance |
| GET | `/api/v1/payments/{paymentAttemptId}` | Planned and disabled | Read server-verified payment status |
| POST | `/api/v1/webhooks/paystack` | Planned and disabled | Receive signature-verified provider events |

Role-specific driver onboarding, refresh-session rotation/revocation, ride-booking, assignment, booking verification, admin workflows, matching, and payments remain unimplemented.

## Resource visibility and privacy

- Sender booking details are visible only to the booking owner and authorized support/admin roles.
- Driver offer cards include parcel category/size and pickup/destination details needed to assess a job, but do not expose recipient phone/name before a confirmed assignment and payment.
- Fare-offer summaries use a public display name and operational profile fields, not the driver's legal identity or settlement account details.
- Provider references, internal settlement routing and raw webhook payloads are never returned to client-facing payment responses.

## Geography and maps

- State codes use ISO 3166-2 format for Nigeria (for example, `NG-LA` for Lagos); country codes use ISO 3166-1 alpha-2 (for example, `NG`). LGA codes must come from a reviewed reference source; do not fabricate codes.
- A booking records both `pickupServiceZoneId` and `destinationServiceZoneId`. Both ends must be covered by an active service zone for the requested service. This permits cross-zone and cross-state routes without treating a single zone as the whole journey.
- Geocoding produces a candidate address/coordinate, not service eligibility. Verify that the selected coordinates are consistent with the chosen zone and operational policy.
- Route distance and ETA are estimates, not fare guarantees. Pricing rules and negotiated fare are authoritative.
- Map endpoints must be authenticated where appropriate, rate-limited, and bounded to control provider spend. Provider API keys must never be sent to clients.

## Fare acceptance and payment sequence

1. Sender creates a draft parcel booking with pickup/destination addresses, coordinates and both service-zone IDs.
2. Backend validates both zones and parcel-service availability.
3. Matching offers the job to eligible drivers using fresh location data, service coverage and availability.
4. Drivers submit fare proposals. Each proposal has server-controlled expiry and immutable history.
5. Sender accepts exactly one unexpired proposal.
6. In a database transaction, the backend snapshots the agreed driver fare, fixed connection fee, other disclosed charges, pricing-rule version and customer payable amount. It reserves the selected driver in `AWAITING_PAYMENT` and withdraws competing offers.
7. Only then may payment initialization run. The client submits the booking reference and idempotency key—not the amount, platform fee, subaccount, provider reference or split values.
8. The backend builds a server-controlled, versioned Paystack split configuration using an eligible driver settlement destination. The driver allocation plus platform allocation must equal the expected customer amount; provider fees are tracked separately.
9. Only a verified provider success for the expected reference, amount and currency confirms payment and allows fulfilment to proceed.
10. Failed/expired payment releases the temporary reservation idempotently and returns the booking to matching or a terminal state according to the policy.

Paystack split payments are not escrow. Split routing, settlement timing, provider fees, refunds and driver-account eligibility must be confirmed against the actual merchant account before implementation is approved.

## Client readiness gate

Client applications should not be built against draft assumptions. Before client work starts, the backend must have:
- OpenAPI contracts reviewed and request/response schemas validated.
- Authentication, authorization and ownership rules.
- Lifecycle transition tests.
- Idempotency and concurrency tests for fare acceptance, assignment reservation and payment callbacks.
- PostgreSQL constraint tests and a reviewed initial migration.
- A documented API base URL and per-environment configuration.

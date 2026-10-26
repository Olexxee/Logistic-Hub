# Backend API Contracts

**Status:** Initial contract baseline; only the root metadata route and health route are implemented. Business endpoints below are planned, not available yet.

## Decisions

- Implement backend APIs first. Do not start client applications until the request/response contracts and lifecycle transitions are stable.
- Use a versioned prefix: `/api/v1`.
- Use JSON request/response bodies and ISO-8601 UTC timestamps.
- Return monetary values as integer minor units (NGN kobo), serialized as decimal strings when values can exceed JavaScript's safe integer range. Never use floating-point currency.
- Never accept client-authoritative booking status, payment status, assigned driver, verification status, payout status, or ledger entries.
- Use explicit idempotency keys for retriable state-changing operations.
- Keep driver fare, fixed platform connection fee, and other disclosed charges separate.
- Driver fare must be negotiated and explicitly accepted by the sender before payment begins.
- Payments remain disabled until the project owner explicitly approves implementation and activation.
- Map provider credentials remain server-side; provider responses must be normalized before they reach clients.

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

Error responses must not expose stack traces, provider secrets, raw database errors, or sensitive personal data. Validation errors may include field paths and safe messages.

## Implemented routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | API name, version and health-route location |
| GET | `/api/v1/health` | Process health; does not yet prove database readiness |

## Planned API groups

These are contract targets, not implemented routes:

| Group | Initial responsibilities |
|---|---|
| `/auth` | Registration, login, refresh/revocation, phone/email verification |
| `/service-zones` | Active zones and service availability for supported Lagos LGAs |
| `/maps/geocode` | Normalize a user-supplied address to a candidate coordinate and formatted address |
| `/maps/routes` | Return normalized route distance and ETA between validated coordinates |
| `/parcel-bookings` | Create draft, request matching, inspect booking and event timeline |
| `/driver/offers` | View eligible offers, propose/accept/decline fare, expire offers |
| `/parcel-bookings/:id/accept-fare` | Sender explicitly accepts one valid driver offer |
| `/payments` | Initialize and verify payment only after accepted fare; disabled until approval |
| `/driver/assignments` | Assignment lifecycle and custody milestones |
| `/verification` | Single-use pickup QR/PIN verification |
| `/admin` | Service-zone configuration, verification, audit and support operations |

## Maps contract rules

- Geocoding is a candidate location, not proof that the location is within an active service zone. Validate zone eligibility separately.
- Clients may submit an address or map-pin coordinates. The backend validates coordinates and normalizes provider results.
- Route distance and ETA are estimates; pricing rules remain authoritative and are versioned.
- The backend must not expose provider API keys or raw provider payloads.
- Maps endpoints must be rate-limited and bounded to prevent accidental or abusive provider spend.

## Fare acceptance and payment sequence

1. Sender creates a parcel booking with valid route, contact and parcel details.
2. Backend checks that the pickup zone and parcel service are active.
3. Matching sends eligible drivers a privacy-minimized offer.
4. Drivers may propose a fare. A proposal has an expiry and immutable history.
5. Sender accepts exactly one unexpired proposal.
6. In a database transaction, the backend snapshots the agreed driver fare, fixed connection fee and disclosed additional charges; it reserves the selected driver with an `AWAITING_PAYMENT` assignment and withdraws competing offers.
7. Only then may the payment module initialize a payment attempt. It must use an idempotency key and a server-calculated amount.
8. Payment routing must use a server-controlled, versioned split configuration for the platform and an eligible driver settlement destination. The customer-facing fare and fixed connection fee remain separate in the internal ledger.
9. Only verified provider success for the expected reference, amount and currency confirms the assignment and allows fulfilment to proceed.
10. Expired or failed payment must release the temporary reservation safely and return the booking to matching or a terminal state according to the explicit policy.

Paystack split payments are not treated as escrow. Split routing, settlement timing, provider fees, refund behavior and driver account eligibility must be verified against the actual merchant account before implementation is approved.

## Contract stability gate for clients

Before client work starts, the backend must have:
- OpenAPI documentation for implemented endpoints and their error envelopes.
- Request/response schemas and lifecycle transition tests.
- Auth/authorization and ownership rules.
- Idempotency and concurrency tests for fare acceptance, assignment reservation and payment callbacks.
- A documented API base URL and environment configuration.

# Foundation Decisions

This document records decisions that must remain stable while API contracts and the first service modules are built.

## 1. Multi-state operating model

- Logistic Hub is one platform and one shared data model across Nigerian states. A state is an operating jurisdiction/configuration boundary, not automatically a separate company or database.
- Geography is normalized as country → state → LGA → service zone. Service zones may cover all or part of an LGA; a state/LGA/zone record does not imply that service is live there.
- Country codes use ISO 3166-1 alpha-2; Nigerian state codes use ISO 3166-2, such as `NG-LA`. LGA codes are imported from a reviewed source, never invented.
- Each parcel/ride booking stores both pickup and destination service-zone references. Cross-zone and cross-state trips are possible only when both ends and the service type are active under operational policy.
- Availability is configured by zone and service type. Parcel delivery, passenger rides, hub points and business logistics can be enabled independently.
- Drivers declare explicit zone/service coverage. Candidate matching checks coverage, service activation, verification, availability and location freshness.
- Initial rollout covers multiple Lagos LGAs. Do not create fake drivers, bookings or coordinates to make production look populated. Reference geography is configuration data; operational data and test fixtures are separate.

## 2. Maps and location services

- Maps support address geocoding, map-pin coordinates and route distance/ETA. They do not replace Logistic Hub's own geography or service availability records.
- Provider calls run server-side. API keys must not be embedded in browser/mobile bundles or returned by the API.
- Application code depends on a provider-neutral interface (`geocode`, `computeRoute`); Google Maps is the first adapter.
- Coordinates are validated to latitude [-90, 90] and longitude [-180, 180]. Geocoding results are candidates and must be checked against the selected service zone.
- Route distance/ETA is an estimate, not a fare guarantee. Pricing is server-side and versioned; driver fare is negotiated and explicitly accepted.
- Do not persist every route response indefinitely. Persist selected address and coordinates needed for fulfilment, plus provider IDs/route metadata only where justified.
- Driver matching uses fresh database-backed location records. A map provider does not decide driver availability or assignment.
- PostGIS indexes require explicit, reviewed migrations and integration tests; Prisma schema validation does not create spatial indexes.

### Current code status

The Google Maps adapter supports server-side geocoding and route computation. It is not connected to public API routes and is disabled by default. It requires `MAPS_PROVIDER=google` and a server-only `GOOGLE_MAPS_API_KEY`; tests use mocked responses only.

## 3. Paystack split-payment model

- Intended sequence: driver proposes fare → sender accepts → server snapshots agreed driver fare, fixed platform connection fee and disclosed additional charges → sender initiates payment.
- The request body must not control payable total, platform fee, settlement destination, split allocations, provider reference or payment success.
- Driver and platform allocations are stored separately from the provider fee and tied to a versioned settlement-routing snapshot for each payment attempt.
- The driver allocation represents the accepted driver fare. The platform allocation represents the fixed connection fee plus any other explicitly disclosed customer charges assigned to the platform. Their sum must equal the expected customer payment amount.
- Driver settlement destinations are provider-scoped records. An account record is not active or payout-eligible until verified through the provider and approved by the business.
- A Paystack split is a settlement-routing mechanism, not escrow and not proof of fulfilment. Do not promise delayed release, custody-based escrow or payout timing without provider confirmation.
- Webhooks must be signature-verified and reconciled against server-side transaction verification; duplicate, delayed and out-of-order events are processed idempotently.
- Live payment initialization, subaccount creation, split activation and payout execution remain disabled pending explicit owner approval and verification of merchant-account eligibility, fees, settlement timing and refund handling.

## 4. Persistence and release gates

- PostgreSQL is authoritative for booking state, payment state, assignment and ledger history.
- Monetary values use integer minor units. API responses serialize them as decimal strings to avoid JavaScript precision errors.
- Database constraints enforce polymorphic-reference exclusivity, coordinate bounds, accepted quote totals, split allocation consistency and one active assignment per booking/driver.
- A row-level constraint cannot enforce a balanced multi-row ledger journal or cross-record quote/payment equality; these are transactional service invariants with integration tests.
- Keep schema, supplemental SQL and migrations in the same reviewable branch. No production migration, merge to `main`, or live payment enablement is authorised by this foundation work.

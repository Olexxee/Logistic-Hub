# Foundation Decisions

This document records decisions that must remain stable while API contracts and the first service modules are built.

## 1. Multi-state operating model

- Logistic Hub is one platform and one shared data model across Nigerian states. A state is an operating jurisdiction/configuration boundary, not automatically a separate company or database.
- Geography is normalized as country → state → LGA → service zone. Service zones may cover all or part of an LGA; state/LGA existence does not mean the service is live there.
- Availability is configured by zone and service type. Parcel delivery, passenger rides, hub points and business logistics can be enabled independently.
- Drivers declare explicit zone/service coverage. Candidate matching must check coverage and service activation in addition to physical distance.
- Launch activation is controlled through database configuration, starting with multiple Lagos LGAs. Do not create fake drivers, bookings, coordinates or zones to make the application appear populated.
- Geography reference data is legitimate configuration data and may be imported from a reviewed source. Operational/test data belongs in isolated test fixtures, never production seed scripts.

## 2. Maps and location services

- Maps are used for user-entered address geocoding, map-pin coordinates and route distance/ETA. Maps results do not define service availability or replace Logistic Hub's own geography and operational records.
- Provider calls run server-side. API keys must not be embedded in browser/mobile bundles or returned by the API.
- Application code depends on a provider-neutral interface (geocode and computeRoute), not provider-specific response payloads. Google Maps is the first adapter; a provider can be replaced without changing booking/matching business rules.
- Coordinates are validated to latitude [-90, 90] and longitude [-180, 180]. A geocoded result must be checked against service-zone coverage before a booking can be accepted.
- Route distance/ETA is an estimate, not a promised fare or service guarantee. Fare calculation remains a server-side pricing rule with a versioned snapshot.
- Do not persist every route response indefinitely. Persist the selected pickup/destination address and coordinates needed for fulfilment; retain provider place IDs or route metadata only where operationally justified.
- Driver matching must use fresh driver-location updates and database-backed eligibility. A map provider is not the source of truth for driver availability or assignment.
- Spatial radius/boundary queries require reviewed PostgreSQL/PostGIS migrations and integration tests. Do not assume Prisma schema validation created spatial indexes.

### Current code status

The Google Maps adapter supports server-side geocoding and route computation. It is not yet connected to public API routes, and requires MAPS_PROVIDER=google plus a server-only GOOGLE_MAPS_API_KEY. The default is MAPS_PROVIDER=none; missing credentials fail closed. No live maps requests are made by the test suite.

## 3. Paystack split-payment model

- Paystack is the intended payment provider. The intended commercial flow is: driver proposes fare → sender accepts → server snapshots the driver fare and fixed platform connection fee → sender initiates payment.
- The payment request must be server-calculated and idempotent. Never trust a client-supplied payable total, subaccount code, platform fee, amount, or payment-success state.
- The product model is a shared platform with a platform account and eligible driver settlement destinations (Paystack subaccounts or another provider-supported mechanism confirmed for the merchant account). Split-payment configuration is data, versioned and auditable—not hard-coded in booking handlers.
- The driver fare and platform connection fee are separate business line items. The platform fee is fixed by the active pricing rule; it is not a percentage of the driver's negotiated fare.
- A Paystack split is a settlement-routing mechanism, not escrow and not proof that a driver has completed a delivery. Do not promise delayed release, custody-based escrow, refunds, or payout timing unless Paystack confirms the specific account capability and product terms.
- Webhook events are untrusted until signature verification and server-side transaction verification. Handle duplicate, delayed and out-of-order events idempotently; reconcile provider records against internal payment attempts and a balanced ledger.
- Live payment initialization, subaccount creation, split activation and payout execution remain disabled until the owner approves implementation and the exact Paystack settlement model, fees, refund handling and account eligibility are verified.

## 4. Persistence and release gates

- PostgreSQL is the source of truth. Maps, payment providers, queues and clients are external integrations, not authorities over booking state.
- Every financial amount is stored as an integer in minor currency units. Currency and pricing/payment-routing snapshots are stored with the relevant booking/payment attempt.
- Database constraints must enforce polymorphic-reference exclusivity, non-negative amounts, unique provider references, and at most one active assignment per booking where applicable. Use reviewed SQL migrations for constraints Prisma cannot represent.
- Keep schema changes, migrations and application changes together in the same reviewable branch. Validate migrations against a clean disposable PostgreSQL database before treating CI schema validation as sufficient.
- No production migration, merge to main, or live payment enablement is authorised by this foundation work.

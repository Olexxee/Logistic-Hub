# Ordinary customer booking: unified pricing and fulfilment contract

## Status

Architecture audit completed against the current `main` implementation after platform route pricing, integration local tariffs, and fixed-payout integration dispatch were merged.

This document records the implementation boundary for ordinary Logistic Hub customer bookings. It does not activate routes, create tariffs, alter production records, or claim that customer bookings are ready for fixed-tariff fulfilment.

## Current implementation gaps

The ordinary customer booking path currently differs materially from the newer route tariff flow:

1. `POST /api/v1/parcel-bookings` resolves pickup and destination zones from coordinates, but then selects a legacy `PricingRule` by pickup zone (or global fallback). It does not require directed `PlatformRouteAvailability` or resolve a `PlatformRouteRate`.
2. The customer booking payload contains `parcelCategory` and free-text `parcelSize`, but no measured `weightGrams` or structured dimensions. A weight-banded platform tariff cannot be selected safely from the current payload.
3. The ordinary booking flow creates a `DRAFT` booking with a legacy connection fee and no route tariff snapshot. The customer flow continues to use driver fare negotiation.
4. The LOCAL_DIRECT integration quote path uses explicit directed route availability and platform route rates, and snapshots customer transport charge, platform charge, and driver payout. This logic is currently inside the integration quote service rather than a reusable customer/integration pricing service.
5. Fixed-payout driver acceptance exists, but dispatch eligibility is restricted to integration-owned, paid/released shipments. It is not yet a general ordinary-customer dispatch path.
6. Hub-assisted routes remain intentionally unavailable where collection, inter-hub transport, handling, and final-mile prices are not all represented by real operational tariffs.

## Non-negotiable domain rules

- Logistic Hub is the delivery platform and the source of truth for serviceability, route planning, pricing, quotes, booking, dispatch, tracking, and driver settlement.
- MarketIQ is a separate client system. It requests quotes and bookings through the integration boundary; it must not own or duplicate Logistic Hub pricing logic.
- Ordinary Logistic Hub customers and integration clients must call the same pricing and fulfilment domain services. Interface, identity, billing agreement, payment ownership, and external event delivery may differ; tariff selection and route feasibility must not.
- Zone service availability is not route availability. A directed origin-to-destination corridor must be explicitly approved.
- A published tariff is not proof of driver capacity or permission to dispatch.
- Package tariff selection must use measured or explicitly accepted package facts. Never infer a weight band from a free-text size label.
- Customer charges and driver payouts are separate amounts. Never derive payout as a margin or percentage of the customer charge.
- Money remains integer minor-unit strings at API boundaries and BigInt internally.
- Quote snapshots must pin tariff IDs, versions, package facts, route topology, charge components, payout components, currency, and expiry. Acceptance must revalidate the snapshot and route conditions.
- A route with no unique matching tariff must fail closed. No fallback to pickup-zone pricing, guessed defaults, or another corridor.
- HUB_ASSISTED remains unavailable until each operational leg and hub handling component has explicit pricing and an executable dispatch/settlement model.

## Required implementation sequence

### CBP-01 — Shared tariff assessment domain service

Extract the platform-operated route tariff selection and quote arithmetic currently embedded in `integration-quote.service.js` into a reusable domain service. It should accept a transaction/client, resolved directed corridor, currency, package facts, and evaluation time; return a typed assessment with one of:

- `QUOTED`
- `NO_COVERAGE`
- `PRICING_AMBIGUOUS`
- `REQUIRES_MEASUREMENT`
- `REQUIRES_OPERATIONAL_PRICING`

A quoted result must include a complete immutable internal snapshot and separate customer charge and driver payout totals. Integration quote code should consume this service without changing its public response contract. Ordinary customer quote code must consume the same service.

The service must not silently select a legacy `PricingRule` when an explicit platform tariff is expected. Partner rate-card pricing and hub-assisted multi-leg pricing remain separate execution topologies and must not be represented as platform-operated rates.

### CBP-02 — Ordinary customer package facts

Extend the ordinary booking request and persisted booking package representation to capture package category, measured weight in grams, and optional dimensions in millimetres. Validate positive bounded integers and persist the submitted facts. Keep the existing free-text size field only as a display/compatibility field; it is not a tariff selector.

The booking form must collect the required measurements before showing a firm tariff quote. If required measurements are absent, show a measurement-required assessment rather than inventing a quote.

### CBP-03 — Customer route quote lifecycle

Add a customer-authenticated quote assessment endpoint that:

- resolves both coordinates against active parcel zones on the server;
- checks explicit directed route availability;
- resolves the route topology;
- assesses package facts through CBP-01;
- returns a quote only for a unique, effective tariff match;
- returns clear non-bookable assessment reasons otherwise;
- exposes customer charges only, never driver payout;
- persists a versioned quote snapshot with expiry and idempotent request semantics.

Draft creation/acceptance must consume the server quote, not recalculate a different amount from client-supplied values. Revalidate the route, tariff version, package fit, and amount at acceptance.

### CBP-04 — Ordinary customer fixed-payout fulfilment

Generalize the fixed-payout dispatch and acceptance workflow without weakening its safety checks. The ordinary customer path must have an explicit payment/release condition appropriate to customer-owned bookings; it must not be forced through integration-only packing evidence or integration client authorization.

Admin matching must be limited to a paid booking with a valid accepted platform tariff snapshot, an eligible LOCAL_PICKUP leg, an enabled directed corridor, and a positive fixed payout. Driver acceptance must revalidate driver KYC, capabilities, documents, active verified vehicle, location/coverage, booking payment state, tariff snapshot, offer state, and idempotency scope transactionally.

Completion must create exactly one pending payout record. This is a ledger/payout obligation, not proof of automatic bank transfer. Settlement execution and reconciliation remain separately verified operational capabilities.

### CBP-05 — Frontend booking experience

Implement the booking flow as progressive steps:

1. Route: pickup and destination addresses, coordinate/map confirmation, and early server-side serviceability assessment.
2. Parcel: category, measured weight, optional dimensions, recipient and handling details.
3. Delivery option and price: show only a currently quotable route, customer charge breakdown, currency, quote expiry, and any supported transit estimate. Do not show driver payout.
4. Review and confirm: show route, package facts, recipient, and exact accepted customer price.
5. Tracking: show a truthful lifecycle timeline for payment, dispatch, assignment, pickup, transit, delivery, and exceptions.

Use the existing customer design tokens and responsive component foundation. Booking, list, and detail views should share consistent validation, loading, empty, error, and status treatments. Correct workspace navigation; detail pages must not hard-code a route that exits the customer workspace.

## Acceptance criteria

- The same package/corridor inputs produce the same tariff assessment in ordinary customer and integration flows.
- A disabled or missing directed corridor cannot produce a firm customer quote or booking.
- Missing package measurements cannot produce a weight-banded quote.
- Missing or overlapping tariff matches fail closed.
- Client-provided zone IDs, tariff IDs, prices, payout values, and route modes are never authoritative.
- Customer responses never expose driver payout or internal tariff selection metadata that would reveal payout.
- Quote acceptance is bound to the immutable snapshot and cannot be repriced by mutating client input.
- Ordinary customer dispatch uses the same fixed-payout safety checks but its own correct customer payment/release gate.
- No hub-assisted booking is offered until all legs are priced and dispatchable.
- Tests cover missing route availability, missing measurement, package mismatch, no tariff, ambiguous tariff, expired quote, retired/replaced tariff, route disablement, payout privacy, dispatch gating, driver ineligibility, duplicate acceptance, and exactly-once payout creation.
- CI passes before merge. Production activation is a separate, explicitly reviewed operational change.

## Operational rollout boundary

This implementation does not seed or activate Osun corridors, publish rates, assign driver coverage, create hubs, or change production environment variables. Osun's 30 administrative polygons remain geography reference boundaries only. Each directed corridor requires explicit route approval, real tariff configuration, and independently verified operational capacity before customer booking can be enabled.

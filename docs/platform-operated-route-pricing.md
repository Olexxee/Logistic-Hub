# Platform-operated route pricing

## Separate operational and financial decisions

- Zone availability confirms that each endpoint zone offers parcel delivery.
- Route availability is an explicit Admin approval for one directed origin-to-destination corridor. It is not inferred from two enabled zones.
- Customer transport charge and platform charge define the customer tariff.
- Driver payout is stored independently and is never calculated by subtracting a margin from the customer charge or copied from it.
- Driver eligibility, dispatch capacity and operational readiness remain separate controls. A published tariff is not dispatch authorization.

## Rate lifecycle

Create a DRAFT rate with route, package category, weight band, optional dimension ceilings, currency, customer transport charge, platform charge, driver payout and effective dates. Enable route availability independently. Publishing requires an enabled route and both endpoint zones to remain active and parcel-serviceable. Active rates are immutable; changes require a new version. Overlapping active weight/effective ranges for the same directed route, package category and currency are rejected. Create, publish, retire and route-availability mutations require a reason and write actor-attributed operational audit events.

## Admin API

All endpoints require authenticated ADMIN access.

- GET /api/v1/admin/platform-route-pricing/rates (optional originServiceZoneId, destinationServiceZoneId, status filters)
- POST /api/v1/admin/platform-route-pricing/availability
- POST /api/v1/admin/platform-route-pricing/rates
- POST /api/v1/admin/platform-route-pricing/rates/:rateId/publish
- POST /api/v1/admin/platform-route-pricing/rates/:rateId/retire

Money is represented as integer minor-unit strings (kobo for NGN), never floating point. Availability body requires route IDs, isEnabled and reason. Rate body requires route IDs, parcelCategory, customerTransportChargeMinor, platformChargeMinor, driverPayoutMinor, optional package limits/effective dates and reason.

## Quote integration

- LOCAL_DIRECT integration quotes now require explicit directed route availability and exactly one active matching platform tariff per package. No default price or partner-rate fallback is used.
- The quote snapshots every tariff ID/version and its customer transport charge, platform charge and driver payout. The customer response excludes driver payout.
- Shipment creation revalidates the directed availability, active tariff versions, package constraints and all totals. The accepted payout is copied into the internal booking pricing snapshot and legacy driver-fare amount; it is not recalculated from the customer charge.
- A LOCAL_DIRECT shipment receives one LOCAL_PICKUP delivery leg. The existing END_TO_END partner quote path remains unchanged.
- HUB_ASSISTED remains unavailable until its actual pickup, transport, hub-handling and final-mile legs each have complete pricing.
- **Dispatch limitation:** fixed-payout driver acceptance and settlement execution are not yet enabled by this integration. A platform-priced quote is not proof of driver capacity or permission to dispatch. Do not activate a corridor for customer booking until the fixed-payout dispatch/settlement workflow and operational driver capacity are verified.

## Osun rollout

No availability or rates are seeded by this migration. Osun remains non-bookable until Admin approves each directed corridor, publishes actual commercial rates, and operations confirms driver capacity. Do not infer all-to-all availability from the 30 LGA boundaries.

## Deployment

Apply the migration through the reviewed deployment pipeline and regenerate Prisma Client. This change does not alter Render environment variables or production serviceability/pricing records.

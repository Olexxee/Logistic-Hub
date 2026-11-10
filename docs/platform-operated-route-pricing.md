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

## Quote integration boundary

This migration and Admin API establish the route tariff source of truth. They do not create prices for unconfigured routes and do not change partner rate cards. Quote generation must consume these rates only for platform-operated direct routes, snapshot the selected rate and driver payout, and revalidate route availability and package fit at acceptance. Hub-assisted topology requires pricing for its actual pickup, hub handling, transport and final-mile legs; this direct tariff must not be applied to it. Dispatch must pass the independent driver payout into the existing driver-fare/payout workflow.

## Osun rollout

No availability or rates are seeded by this migration. Osun remains non-bookable until Admin approves each directed corridor, publishes actual commercial rates, and operations confirms driver capacity. Do not infer all-to-all availability from the 30 LGA boundaries.

## Deployment

Apply the migration through the reviewed deployment pipeline and regenerate Prisma Client. This change does not alter Render environment variables or production serviceability/pricing records.

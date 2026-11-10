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


## Fixed-payout local driver execution

Platform-operated `LOCAL_DIRECT` shipments now use the accepted tariff's immutable `driverPayoutMinor` as the fixed driver offer amount. Admin dispatch is available only after the integration client has confirmed payment, frozen the required packing evidence, and explicitly authorized dispatch. The admin dispatch endpoint is:

- `POST /api/v1/admin/delivery-legs/:legId/request-matching`

It is restricted to platform-priced `LOCAL_PICKUP` legs whose booking has an integration client, `paymentStatus=SUCCEEDED`, and `integrationDispatchAuthorizedAt`. It does not make partner-executed or ordinary customer bookings eligible for this fixed-payout flow.

Eligible drivers see the fixed payout on their offer and accept it with a selected eligible vehicle:

- `POST /api/v1/driver/delivery-leg-offers/:offerId/accept-fixed-payout`
- Required body: `vehicleId`
- Required header: `Idempotency-Key`

The fixed payout is not negotiable, is not derived from the customer charge, and is not included in customer-facing quote/offer responses. The driver acceptance transaction rechecks driver KYC/capability/documents, vehicle eligibility, live availability/location, zone coverage, route availability, shipment payment/release state, and the offer's payout snapshot. It reserves the driver, withdraws competing offers, creates an `ACCEPTED` assignment with `agreedFareMinor` equal to the fixed payout, and advances the leg and booking to assigned states.

Delivery verification uses the existing assignment completion path. On successful final delivery verification, the existing idempotent `DriverPayout` creation records the assignment's `agreedFareMinor` under `completion-<assignmentId>`. This creates a pending payout record; it does not itself initiate a bank transfer or mark the payout paid. Existing payout operations and reconciliation remain separate.

A published route tariff and an authorized shipment still do not guarantee capacity. Matching fails closed when no eligible driver is available. Production route activation remains blocked until operational driver coverage, pickup capacity, and the payout operations workflow are validated.

# Database Integrity and Migration Strategy

## Current state

- `prisma/schema.prisma` is the declarative relational model.
- `prisma/constraints/foundation.sql` contains supplemental PostgreSQL checks and partial unique indexes that Prisma cannot represent fully.
- CI generates a disposable base schema from the Prisma model, applies it to PostgreSQL 16, applies the supplemental constraints, runs schema-drift validation, and exercises critical constraints.
- There is **not yet a committed deployable initial migration**. The generated SQL in CI is a validation artifact, not production migration history. Do not run `prisma migrate deploy` against any environment until the initial migration has been generated, reviewed, committed and tested from an empty database.

## Geography invariants

A service zone has a required state and an optional LGA. If an LGA is supplied, its state must equal the service zone's state. The Prisma relation uses a composite foreign key to `lgas(id, stateId)`; PostgreSQL enforces the pair rather than relying on application code alone.

Parcel and ride bookings record both `pickupServiceZoneId` and `destinationServiceZoneId`. Both zone IDs reference `service_zones` independently, so the service layer must also confirm that both zones are active for the requested service and that the route is allowed by the operating policy.

Country codes should use ISO 3166-1 alpha-2. Nigerian state codes should use ISO 3166-2 subdivision codes such as `NG-LA`. LGA codes must be imported from a reviewed source; an LGA code is nullable until a reliable canonical identifier is established.

## Supplemental database constraints

The checked-in SQL applies the following safeguards:

- Exactly one parcel/ride booking reference for driver offers, assignments, payment attempts, payouts, verification tokens and booking events.
- At most one booking type reference on ledger entries; platform-level ledger entries may have neither.
- At most one active assignment per booking and one active job per driver.
- Positive payment, ledger-entry and payout amounts; non-negative fare/pricing amounts; and consistent accepted booking totals.
- Payment split allocations are either entirely absent or complete, linked to a driver settlement account, accompanied by a routing snapshot, non-negative, and equal to the expected payment amount.
- Latitude/longitude bounds on driver locations, parcel/ride endpoints and hub points.
- Valid pricing-rule amount/version/effective-window values.

The database cannot, with a row-level CHECK alone, guarantee that multiple ledger entries in a journal balance or that a payment amount matches a related booking's quote. Those invariants must be enforced in a single transaction by the payment/ledger service, with unique idempotency/source keys and reconciliation tests.

## Migration process

1. Freeze the schema for the foundation review.
2. Generate the base SQL using the pinned Prisma CLI against the checked-in schema.
3. Review generated identifiers, enum definitions, foreign keys, indexes and defaults.
4. Include the reviewed base SQL and supplemental constraints in the first committed migration history. Keep PostGIS/spatial indexes in a separate migration if the deployment image/database has the extension available.
5. Apply the full migration chain to an empty disposable PostgreSQL database.
6. Run the PostgreSQL integrity tests, API tests, Prisma validation/client generation and schema-drift checks.
7. Verify forward deployment and documented recovery/rollback strategy before staging.
8. Only after review, test the same migration chain against a staging database. Production migrations require separate explicit approval.

Do not treat `prisma validate` or `prisma generate` as proof that PostgreSQL constraints or migrations work. CI now tests the generated schema and supplemental SQL against a real disposable PostgreSQL 16 instance, but the first deployable migration still needs to be committed and reviewed.

# Database Integrity and Migration Strategy

## Current state

- `prisma/schema.prisma` is the declarative relational model.
- `prisma/constraints/foundation.sql` contains supplemental PostgreSQL checks and partial unique indexes that Prisma cannot represent fully.
- `prisma/migrations/20261026121500_initial_foundation/migration.sql` is the committed initial migration.
- `prisma/migrations/migration_lock.toml` records PostgreSQL as the migration provider.
- `prisma/constraints/foundation.sql` is the initial supplemental-constraint snapshot included verbatim at the end of the initial migration. It is not a separate deployable migration.
- CI applies the committed migration chain to a disposable PostgreSQL 16 database with `prisma migrate deploy`, checks migration status and Prisma schema drift, and exercises the database constraints.
- The migration has been tested against a disposable CI database only. It has **not** been applied to staging or production.

## Geography invariants

A service zone has a required state and an optional LGA. If an LGA is supplied, its state must equal the service zone's state. The Prisma relation uses a composite foreign key to `lgas(id, stateId)`; PostgreSQL enforces the pair rather than relying on application code alone.

Parcel and ride bookings record both `pickupServiceZoneId` and `destinationServiceZoneId`. Both zone IDs reference `service_zones` independently, so the service layer must also confirm that both zones are active for the requested service and that the route is allowed by the operating policy.

Country codes should use ISO 3166-1 alpha-2. Nigerian state codes should use ISO 3166-2 subdivision codes such as `NG-LA`. LGA codes must be imported from a reviewed source; an LGA code is nullable until a reliable canonical identifier is established.

## Supplemental database constraints

The initial migration's supplemental SQL applies the following safeguards:

- Exactly one parcel/ride booking reference for driver offers, assignments, payment attempts, payouts, verification tokens and booking events.
- At most one booking type reference on ledger entries; platform-level ledger entries may have neither.
- At most one active assignment per booking and one active job per driver.
- An assignment in `AWAITING_PAYMENT` must have a payment-reservation expiry; accepted driver fares and submitted fare proposals must be positive.
- Driver service radius must be positive, rating must be between 0 and 5, job counters and location accuracy must be non-negative, and service-availability windows must be valid.
- Positive payment, ledger-entry and payout amounts; non-negative fare/pricing amounts; and consistent accepted booking totals.
- Payment split allocations are either entirely absent or complete, linked to a driver settlement account, accompanied by a routing snapshot, non-negative, and equal to the expected payment amount.
- Latitude/longitude bounds on driver locations, parcel/ride endpoints and hub points.
- Valid pricing-rule amount/version/effective-window values.

The database cannot, with a row-level CHECK alone, guarantee that multiple ledger entries in a journal balance or that a payment amount matches a related booking's quote. Those invariants must be enforced in a single transaction by the payment/ledger service, with unique idempotency/source keys and reconciliation tests.

## Migration process

1. Treat the initial migration as immutable once merged. Do not edit its SQL to represent later schema changes.
2. For every schema or integrity change, create a new timestamped directory under `prisma/migrations` and include the matching SQL. Any change to the initial constraint snapshot must be reviewed carefully; later changes belong in a new migration, not by rewriting history.
3. CI runs `prisma migrate deploy` against an empty disposable PostgreSQL 16 database and checks `prisma migrate status`.
4. CI verifies Prisma schema drift and runs PostgreSQL integrity tests against the migrated database.
5. Review generated SQL, foreign keys, indexes, enum changes, data migration requirements and recovery strategy before staging.
6. Keep PostGIS/spatial indexes in a separate migration when the target database supports the required extension.
7. Apply the migration chain to staging only after review. Production migration execution requires separate explicit approval.

Passing `prisma validate` or `prisma generate` alone is not proof that PostgreSQL constraints or migrations work. The CI migration path now exercises the committed SQL rather than constructing an untracked baseline.

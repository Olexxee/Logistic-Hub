# Logistic Hub

Logistic Hub is a Nigeria-focused multi-service mobility and logistics marketplace. The initial product focus is instant local parcel delivery, with a fixed sender-paid connection fee and no percentage commission deducted from the driver's agreed fare.

The platform is designed to expand into passenger rides, partner-operated parcel drop-off points, business logistics, and additional states through configuration rather than one-off code changes.

## Product and technical foundation

- [Technical foundation](docs/technical-foundation.md)
- [Foundation decisions: geography, maps and Paystack split payments](docs/foundation-decisions.md)
- [State machines and matching algorithm](docs/state-machines-and-matching.md)
- [Payment ledger and settlement](docs/payment-ledger.md)
- [Database integrity and migration strategy](docs/database-integrity.md)
- [OpenAPI contract baseline](docs/openapi.yaml)
- [Initial database schema](prisma/schema.prisma)
- [Supplemental PostgreSQL constraints](prisma/constraints/foundation.sql)
- [API contract overview](docs/api-contracts.md)

## Initial architecture

- Backend: JavaScript (ES modules), Node.js and Express
- Data layer: PostgreSQL and Prisma ORM
- Geospatial queries: explicit PostgreSQL/PostGIS migration for spatial indexes when the deployment database supports the extension
- Maps: provider-neutral server-side adapter; Google Maps geocoding and Routes API adapter is present but disabled by default
- Payments: Paystack shared/split payments are the intended direction, subject to merchant-account capability and terms validation
- Redis and a queue worker may be added for expiring offers, notifications and retries; PostgreSQL remains the source of truth

## Current status

Backend foundation work is tracked on `feat/backend-foundation` and reviewed in [draft PR #3](https://github.com/Olexxee/Logistic-Hub/pull/3). The branch includes environment validation, an Express API shell, health endpoint, maps adapter, multi-state pickup/destination zones, settlement destination records, OpenAPI contracts and PostgreSQL integrity tests.

The initial migration is committed at `prisma/migrations/20261026121500_initial_foundation/migration.sql`. CI applies the committed migration chain to an empty PostgreSQL 16 database with `prisma migrate deploy`, checks migration history and schema drift, and runs PostgreSQL integrity tests. The initial migration includes the supplemental constraints; CI also checks that the immutable `prisma/constraints/foundation.sql` snapshot remains an exact suffix of that migration. Future database changes must use new timestamped migrations.

The initial rollout targets **multiple Lagos LGAs**. The payment sequence is **driver fare proposal → sender acceptance → payment**. Client applications should wait until the API contracts and lifecycle tests are stable. Maps default to disabled. Payments are hard-disabled and cannot be enabled through configuration.

Do not merge the draft PR into `main`, apply production migrations, or accept live bookings/payments until implementation, tests, security review and regulatory checks are complete and the repository owner approves the next step.

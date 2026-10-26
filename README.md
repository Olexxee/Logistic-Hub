# Logistic Hub

Logistic Hub is a Nigeria-focused multi-service mobility and logistics marketplace. The initial product focus is instant local parcel delivery, with a fixed sender-paid connection fee and no percentage commission deducted from the driver's agreed fare.

The platform is designed to expand into passenger rides, partner-operated parcel drop-off points, business logistics, and additional states through configuration rather than one-off code changes.

## Product and technical foundation

- [Technical foundation](docs/technical-foundation.md)
- [Foundation decisions: geography, maps and Paystack split payments](docs/foundation-decisions.md)
- [State machines and matching algorithm](docs/state-machines-and-matching.md)
- [Payment ledger and settlement](docs/payment-ledger.md)
- [Database integrity and migration requirements](docs/database-integrity.md)
- [Initial database schema](prisma/schema.prisma)
- [API contracts and implementation status](docs/api-contracts.md)

## Initial architecture

- Backend: JavaScript (ES modules), Node.js and Express
- Data layer: PostgreSQL and Prisma ORM
- Geospatial queries: PostgreSQL spatial support, introduced through explicit SQL migrations where Prisma's schema abstraction is insufficient
- Maps: provider-neutral server-side adapter; Google Maps geocoding and Routes API adapter is present but disabled by default
- Payments: Paystack shared/split payments are the intended direction, subject to merchant-account capability and terms validation
- Redis and a queue worker may be added for short-lived matching coordination, notifications and retries; PostgreSQL remains the source of truth

## Current status

The backend foundation is being implemented on `feat/backend-foundation` and tracked in [draft PR #2](https://github.com/Olexxee/Logistic-Hub/pull/2). The branch includes environment validation, an Express API shell, a health endpoint, Prisma validation/client-generation CI, smoke tests and the first provider-neutral maps boundary. Booking, fare negotiation, matching, pickup verification, payment collection and settlement are not implemented yet.

The platform uses one multi-state data model, with service zones and per-service availability controlling rollout. The initial launch targets **multiple Lagos LGAs**. The payment sequence is **driver fare negotiation → sender acceptance → payment**. Backend API contracts must stabilize before client apps begin. Maps default to disabled unless configured with a server-side key. Payments are hard-disabled and cannot be enabled through configuration.

Do not merge this branch into `main`, apply production migrations, or accept live bookings/payments until implementation, tests, security review and regulatory checks are complete and the repository owner approves the next step.

## Working principles

1. The backend is authoritative for booking state, payment state, QR validation and settlement eligibility.
2. The sender sees the delivery fare and Logistic Hub connection fee as separate line items.
3. Driver fare is not calculated as a percentage of the driver's agreed amount.
4. Payment confirmation must be verified server-side and processed idempotently.
5. Parcel and ride workflows share infrastructure but have distinct state machines.
6. Geographic records and actual service availability are separate concerns.
7. State activation, pricing changes, manual financial actions and verification overrides are auditable.

# Logistic Hub

Logistic Hub is a Nigeria-focused multi-service mobility and logistics marketplace. The initial product focus is instant local parcel delivery, with a fixed sender-paid connection fee and no percentage commission deducted from the driver's agreed fare.

The platform is designed to expand into passenger rides, partner-operated parcel drop-off points, business logistics, and additional states through configuration rather than one-off code changes.

## Product and technical foundation

- [Technical foundation](docs/technical-foundation.md)
- [State machines and matching algorithm](docs/state-machines-and-matching.md)
- [Payment ledger and settlement](docs/payment-ledger.md)
- [Database integrity and migration requirements](docs/database-integrity.md)
- [Initial database schema](prisma/schema.prisma)

## Initial architecture

- Backend: JavaScript (ES modules), Node.js and Express
- Data layer: PostgreSQL and Prisma ORM
- Geospatial queries: PostgreSQL spatial support, introduced through explicit SQL migrations where Prisma's schema abstraction is insufficient
- Payments: Paystack, subject to merchant-account capability and terms validation
- Redis and a queue worker may be added for short-lived matching coordination, notifications and retries; PostgreSQL remains the source of truth

## Current status

This repository is establishing the product and technical foundation. It is not production-ready and does not yet implement booking, payment, driver matching or settlement. Do not use it to accept live bookings or payments until implementation, tests, security review and regulatory checks are complete.

## Working principles

1. The backend is authoritative for booking state, payment state, QR validation and settlement eligibility.
2. The sender sees the delivery fare and Logistic Hub connection fee as separate line items.
3. Driver fare is not calculated as a percentage of the driver's agreed amount.
4. Payment confirmation must be verified server-side and processed idempotently.
5. Parcel and ride workflows share infrastructure but have distinct state machines.
6. Geographic records and actual service availability are separate concerns.
7. State activation, pricing changes, manual financial actions and verification overrides are auditable.

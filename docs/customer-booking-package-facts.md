# Customer booking package facts — CBP-02

Ordinary customer bookings persist package facts in the existing `ParcelBookingPackage` relation; no duplicate package table or schema migration is required.

## Request contract

New clients may submit 1–10 packages with:
- `packageCategory` and optional `description`
- positive integer `weightGrams`
- optional complete `lengthMm`, `widthMm`, and `heightMm` dimensions
- optional `declaredValueMinor` as an integer minor-unit string

Dimensions must be supplied as a complete length/width/height set. Weight may be omitted at booking creation, but the server records the package as requiring measurement. It does not invent an estimated weight.

The API continues to accept legacy single-package fields during the frontend migration. Legacy requests are normalized into one `ParcelBookingPackage` row. New multi-package requests use `packages` and must not mix with legacy package fields.

## Data integrity

- Package rows, booking creation and the booking-created audit event are written in one database transaction.
- Reads and idempotent replays include package rows ordered by sequence.
- Customer-supplied measurements are marked `CUSTOMER_DECLARED`.
- The client cannot set assessment status, source, confidence or assessment timestamps.
- Missing weight is marked `REQUIRES_MEASUREMENT`; no tariff match should be treated as valid until the shared pricing assessment has the required package facts.
- Declared package facts are not independently verified measurements and do not authorize dispatch.

## Scope boundary

CBP-02 captures and persists package facts only. Customer tariff assessment/acceptance, fixed-payout dispatch for ordinary customer bookings and the progressive customer booking UI remain subsequent phases.

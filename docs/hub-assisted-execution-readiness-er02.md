# HAT Execution Readiness — ER-02 Driver Payout Policy Administration

## Scope

ER-02 exposes ADMIN-only management for independent local-driver payout rules. It does not create assignments, offers, payouts, partner settlements, or dispatch readiness.

## Endpoints

Mounted at `/api/v1/admin/platform-operational-pricing`:

- `GET /driver-payout-rules` — list rules; optional filters: `serviceZoneId`, `legType`, `parcelCategory`, `currency`, `status`.
- `POST /driver-payout-rules` — create an immutable DRAFT version.
- `POST /driver-payout-rules/:ruleId/publish` — publish a draft after effective-window and active-overlap validation.
- `POST /driver-payout-rules/:ruleId/retire` — retire an active rule.

Every mutation requires a reason of at least five characters and writes an operational audit event. Currency is normalized to uppercase. Monetary values are decimal integer strings and are stored as BigInt. Version increments are scoped to service zone, leg type, category and currency. Mutations use serializable transactions.

## Matching and overlap policy

A rule scope is exactly `serviceZoneId + legType + parcelCategory + currency`. Active rules in the same scope may not overlap in both weight range and effective time. Weight intervals are inclusive, matching the assessment engine. A null maximum is unbounded.

Only `LOCAL_PICKUP` and `FINAL_MILE` are accepted. Hub-transfer and interstate execution remain partner-executed and cannot be configured through this rule family.

## Explicit non-goals

Publishing a payout rule does not prove a driver is eligible, establish capacity, resolve vehicle/KYC/coverage constraints, make a delivery leg ready, or authorize dispatch. ER-03/ER-04 must resolve and persist execution readiness separately and revalidate it transactionally at assignment time.

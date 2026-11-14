# Hub-assisted execution readiness — technical design

**Workstream:** HAT execution readiness  
**Implementation branch:** phased ER-01 through ER-05 delivery on `main`  
**Current slice:** ER-05 lifecycle and regression acceptance  
**Status:** ER-01 through ER-04 are merged. ER-05 is in progress: the initial lifecycle regression (PR #176) and mixed local-driver/partner sequencing regression (PR #177) are merged. PostgreSQL execution-snapshot concurrency coverage is now being added; staging acceptance remains outstanding.

## 1. Objective

Resolve execution eligibility and internal execution cost for each delivery leg independently from customer-facing operational tariffs. A customer quote can be commercially valid while its operational plan remains non-executable and held for review.

## 2. Locked boundaries

1. Customer-facing `PlatformOperationalTariff` records never store driver payouts, partner execution costs, executor identities or agreement terms.
2. Platform local-driver compensation is resolved from a separate `PlatformDriverPayoutRule` policy.
3. Partner execution costs are resolved only from a valid partner agreement and the accepted partner quote/contract snapshot.
4. `LOCAL_PICKUP` payout rules are scoped to the leg's origin service zone.
5. `FINAL_MILE` payout rules are scoped to the leg's destination service zone.
6. `HUB_TRANSFER` and `INTERSTATE_TRANSPORT` remain partner-executed. The local driver payout rule family does not apply to them.
7. Package payout amounts are summed with BigInt arithmetic. Missing measurement, missing coverage or ambiguous active rules fail closed.
8. Customer tariff values are not inputs to the payout assessment function.
9. A resolved payout amount does not by itself prove an eligible executor exists or authorize dispatch.
10. No payment, payout, partner payable or ledger entry is created by readiness assessment.

## 3. Driver payout rule contract

A rule is scoped by:
- service zone;
- eligible local delivery-leg type (`LOCAL_PICKUP` or `FINAL_MILE`);
- canonical parcel category;
- inclusive minimum and maximum weight in grams (null maximum means unbounded);
- currency;
- integer minor-unit driver payout per package;
- immutable version and effective window;
- lifecycle status (`DRAFT`, `ACTIVE`, `RETIRED`).

The model has database checks for leg type, non-empty category, positive payout, valid weight bounds, positive version, ISO currency shape and valid effective dates. The unique scope/version key prevents duplicate versions for the same scope.

Publishing/retiring APIs must be ADMIN-only, require a reason, write operational audit events and reject overlapping active weight bands for the same scope/category/currency. Historical accepted snapshots must not be rewritten when a rule changes.

The first slice adds the schema/migration and a read-only assessment function. It deliberately does not expose a policy-management API yet; rules cannot be operationally configured until that API is implemented.

## 4. Driver payout assessment

`assessPlatformDriverPayout({ tx, leg, packages, currency, now })`:
- accepts only measured packages with category and positive whole-gram weight;
- maps pickup to origin zone and final-mile to destination zone;
- queries active rules effective at the assessment time for the exact scope;
- requires exactly one rule per package;
- returns `NO_PAYOUT_RULE` or `AMBIGUOUS_RULE` on gaps/overlaps;
- returns immutable rule IDs, versions, bands, currency and per-package amounts;
- sums all package payouts with BigInt and serializes the total as a decimal string;
- returns `NOT_APPLICABLE` for partner-executed leg types.

The function is read-only and does not mutate leg status or create assignments.

## 5. Execution-readiness implementation status

### ER-01 — independent driver payout foundation
- Separate, versioned `PlatformDriverPayoutRule` records and read-only package-level payout assessment are implemented.
- Customer operational tariffs remain independent from driver payouts and partner execution costs.

### ER-02 — payout policy administration
- ADMIN policy management, validation, immutable versions, audit reasons and overlap protection are implemented.

### ER-03 — shared per-leg execution-readiness resolver
- The resolver validates accepted route/package snapshots, payment and integration release, local driver eligibility and payout coverage, partner agreement/rate coverage, active service zones, hub status and receiving capacity.
- Assessment is read-only and always returns `dispatchAuthorized: false`.

### ER-04 — immutable execution snapshot and transactional assignment gates
- Versioned executor snapshots preserve selected executor, internal cost source/version, readiness assessment, route and package facts.
- Executor selection and assignment paths revalidate within serializable transactions; later legs remain gated by predecessor completion.
- No external payout, partner payable or settlement is activated.

### ER-05 — lifecycle and regression acceptance

ER-05 closes the execution-readiness workstream with regression coverage across quote acceptance, mixed-route sequencing, executor selection, dispatch/assignment revalidation and customer/internal financial separation.

Coverage is tracked against these invariants:
- Customer and integration HAT quote acceptance preserve the accepted route and package snapshots.
- Mixed local-driver and partner legs are assessed independently; each later leg remains blocked until its immediately preceding leg is completed.
- Missing or ambiguous local payout rules and partner rate coverage fail closed.
- Driver suspension/KYC expiry, unsuitable vehicle, stale location, inactive service zones and insufficient hub capacity cannot be bypassed by a previously successful assessment.
- Partner suspension, agreement expiry, rate-card changes and route mismatch invalidate execution readiness.
- Executor selection is idempotent and append-only; conflicting reuse of an idempotency key is rejected.
- Concurrent readiness/selection/assignment attempts cannot create duplicate active execution.
- Customer quote DTOs expose customer charges only; driver payouts, partner execution costs, executor identities and execution snapshots remain private.
- No ER phase activates external driver payouts, partner payables or settlement transfers.

The regression suite must distinguish unit/mock coverage from PostgreSQL concurrency and staging acceptance. A passing unit suite is not evidence that database races or live operational workflows have been accepted.

## 6. Release constraints

This slice does not enable live payments, external driver payouts or partner settlement. Existing payment and payout activation restrictions remain unchanged. No leg is made dispatchable by this assessment alone.


## ER-03 — shared per-leg execution-readiness resolver

ER-03 introduces a read-only resolver at `src/modules/execution-readiness`. It assesses one HAT delivery leg against the accepted quote's pinned route topology, current booking payment/release state, active service zones, executor eligibility, and independently sourced internal execution cost. The integration shipment acceptance path now preserves HUB_ASSISTED topology as well: it creates the three pinned HAT legs from the selected integration quote option rather than rejecting the option or silently resolving a different hub pair.

### Local-driver legs

- Applies only to `LOCAL_PICKUP` and `FINAL_MILE`.
- Reuses the same driver eligibility query predicates as dispatch: verified driver identity, FULL KYC, active account, approved driver capability, approved active vehicle, enabled parcel coverage for both leg zones, no active assignment, and a fresh location.
- Applies the same pickup-radius calculation used by dispatch, against the leg's origin coordinates.
- Resolves payout independently through `PlatformDriverPayoutRule`; every package must match exactly one active rule for the appropriate zone/leg/category/currency and measured whole-gram weight.
- A driver candidate without a resolved payout, or a payout rule without an eligible driver, is not ready.

### Partner-executed legs

- Applies only to `HUB_TRANSFER` and `INTERSTATE_TRANSPORT`; these leg types remain outside local-driver capability.
- Resolves directional partner rates for the exact origin/destination service-zone pair.
- A single active rate card under an active agreement and active verified partner must cover every package. Package rate matching must be unique; weight and any dimensions required by the rate constraints must be available.
- Returns every qualifying partner/rate-card candidate with agreement ID, rate-card version, per-package rate IDs and the internal execution cost in integer minor units. Candidates are sorted by total cost, then stable IDs. Customer tariff values are never consulted.
- No full-card match, ambiguous package rate, missing package measurement, suspended partner, expired agreement or inactive rate card blocks the leg.

### Hub and route prerequisites

- Every hub referenced by a leg must still exist, be ACTIVE, have a VERIFIED operator, match the accepted route's pinned service zone, and have an active parcel-delivery service zone.
- Every package category must be accepted by the hub.
- Receiving-hub capacity is checked against existing `RECEIVED` and `EXCEPTION` intake records plus the incoming shipment. Parcel-count capacity is always checked; configured weight and volume limits require complete evidence and must not be exceeded.
- Origin hubs are checked for operational status and parcel acceptance but are not charged incoming capacity a second time.
- Hub opening hours are not used as a hard gate because the hub model does not persist a timezone; interpreting local opening-hour strings against server time would be unsafe.

### Resolver contract and safety boundary

The resolver returns `READY` or `BLOCKED` with explicit blocker codes and an execution-mode assessment. It verifies that the delivery leg still matches the accepted quote's immutable route snapshot, and requires successful payment plus integration dispatch release where applicable.

The resolver is read-only: it does not mutate leg status, create offers, assign a driver or partner, create a payable, or initiate a settlement. Its response always sets `dispatchAuthorized: false`. ER-04 must persist an immutable selected-executor snapshot and independently revalidate all conditions inside the assignment transaction before any leg can advance to dispatch.


## ER-04 implementation — immutable executor selection

This implementation slice adds `DeliveryLegExecutionSnapshot`, a versioned per-leg record containing the selected executor, exact internal execution cost, currency, cost-source/version, the full readiness assessment, accepted route snapshot and package facts. The database rejects UPDATE and DELETE operations against these records; a new selection creates a new version rather than rewriting history.

The ADMIN-only `POST /api/v1/admin/delivery-legs/:legId/execution-snapshot` endpoint requires an idempotency key. It re-runs ER-03 assessment inside a serializable transaction, then validates the exact selected driver/vehicle or partner/rate-card candidate. Only a fully resolved selection creates the immutable snapshot and conditionally advances the leg to `READY_FOR_ASSIGNMENT`. Existing active offers or assignments prevent snapshot replacement.

Local HAT driver matching is restricted to the selected driver and uses the snapshot's fixed payout; driver fare proposals are not allowed. Fixed-payout acceptance rechecks the immutable snapshot and reruns readiness assessment inside the acceptance transaction. HAT partner assignment similarly requires the selected partner, agreement, rate-card version and total execution cost to still match a fresh assessment. Neither path uses customer tariff amounts as internal cost.

This slice does not activate payments, driver payouts or partner settlement. The snapshot is an execution authorization record only for the selected leg; it does not release later legs in a multi-leg shipment.

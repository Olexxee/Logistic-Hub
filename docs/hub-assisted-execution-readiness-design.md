# Hub-assisted execution readiness — technical design

**Workstream:** HAT execution readiness  
**Implementation branch:** `feat/hub-assisted-execution-readiness`  
**Current slice:** independent platform-driver payout policy and assessment  
**Status:** first backend slice implemented on this branch; admin policy-management API, shared executor eligibility resolver, partner-cost resolver integration and dispatch activation gate remain outstanding.

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

## 5. Remaining execution-readiness work

### ER-02 — policy administration
- ADMIN list/create/publish/retire endpoints for payout rules.
- Exact-scope filters, strict validation, audit reasons, immutable versions.
- Reject overlapping active rules and invalid effective windows.
- OpenAPI and permission inventory updates.

### ER-03 — shared per-leg readiness resolver
- Load accepted route and package snapshots.
- For local legs, assess payout rules and use existing driver/vehicle/KYC/coverage/location/availability predicates to establish at least one eligible execution candidate.
- For partner legs, resolve the exact accepted partner, active agreement, route/rate coverage, currency and internal execution cost using the existing partner execution contract.
- Check hub status, parcel restrictions, capacity and required custody/route prerequisites where applicable.
- Return explicit blockers; never substitute customer charge for internal cost.

### ER-04 — immutable execution snapshot and dispatch gate
- Persist the readiness result, resolved executor mode, internal cost source/version and assessment timestamp separately from customer pricing.
- Revalidate policy, partner agreement, route, candidate eligibility and capacity inside the assignment transaction.
- Only then conditionally advance a leg from `PLANNED` to `READY_FOR_ASSIGNMENT`.
- Independently require the same valid snapshot/readiness state in driver-offer creation and partner assignment.
- Keep idempotency, serializable transaction boundaries, audit events and race-condition tests.

### ER-05 — lifecycle and regression acceptance
- Customer and integration quote acceptance.
- Multiple legs with mixed local and partner execution.
- Missing/ambiguous payout rules and partner agreements.
- Suspended driver, expired KYC, unsuitable vehicle, stale location, unavailable zone, no capacity.
- Partner suspension/agreement expiry/route mismatch.
- Concurrent readiness and assignment attempts.
- Ensure no internal execution costs leak into customer quote DTOs.

## 6. Release constraints

This slice does not enable live payments, external driver payouts or partner settlement. Existing payment and payout activation restrictions remain unchanged. No leg is made dispatchable by this assessment alone.

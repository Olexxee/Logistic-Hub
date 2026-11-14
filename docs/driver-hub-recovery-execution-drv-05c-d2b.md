# DRV-05C-D2B — Hub recovery route execution authorization

**Status:** Backend D2B implementation is in [PR #184](https://github.com/Olexxee/Logistic-Hub/pull/184), ready for review. GitHub Actions run #43556350937 passed, including Prisma/OpenAPI validation and the full API/PostgreSQL integrity test step. Frontend recovery workflows and staging acceptance remain separate; staging is deferred until Neon is provisioned.  
**Depends on:** merged DRV-05C-D1 hub intake and D2 disposition/route continuation (backend PRs #130 and #131).  
**Scope:** Backend execution readiness, internal cost resolution, immutable executor selection, partner/driver assignment revalidation, and custody-release gating for a D2-created continuation leg.

## 1. Problem statement

D2 can approve a route from a safety-recovery hub and create a new `PLANNED` delivery leg. It deliberately does not price, select an executor, assign the leg, or release physical custody.

The normal execution-readiness path cannot simply be reused unchanged:

- It requires the leg to match a leg in the original accepted quote's route snapshot. A D2 continuation leg is a new route and must not be inserted into or silently rewrite that historical quote.
- It checks package facts against the quote leg with the same sequence/type. A recovery-created leg has a new sequence and route.
- The normal predecessor rule requires the immediately preceding leg to be `COMPLETED`. In a D2 recovery, the superseded source leg is correctly `FAILED`, not completed.
- Customer operational tariff assessment maps `HUB_PAIR` to `INTERSTATE_TRANSPORT`; it is not a valid customer-tariff shortcut for every recovery leg, particularly same-state `HUB_TRANSFER`.
- Partner assignment already has a guarded HAT `HUB_TRANSFER` path, but it expects an accepted-quote-backed execution snapshot. D2 needs an explicit recovery-disposition-backed authorization path.

These are legitimate domain differences, not conditions to bypass with a metadata flag alone.

## 2. Locked commercial and safety boundaries

1. **No additional customer charge is created by D2B.** The original accepted customer quote and successful payment remain historical commercial facts. A route change caused by safety recovery does not silently reprice or debit the customer.
2. Partner rate-card amounts are internal execution costs only. They must never be copied into customer tariff or quote fields.
3. If the business later decides that a recovery route can incur an additional customer charge, that requires a separate customer disclosure, authorization and payment workflow. It is outside D2B.
4. `HUB_TRANSFER` and `INTERSTATE_TRANSPORT` are partner-executed. Their internal cost must come from one active verified partner, agreement and rate-card version that covers every package on the exact directed service-zone pair.
5. `FINAL_MILE` is platform-driver-executed. Its internal cost must come from the destination-zone `FINAL_MILE` payout rules and the selected eligible driver/vehicle.
6. A recovery-created leg is not dispatchable merely because D2 approved its route. It must pass fresh route, package, zone, hub, capacity, executor and internal-cost checks.
7. No external payout, partner settlement, refund, or seller settlement is activated by D2B. Existing partner payable lifecycle behavior is not expanded by this phase.
8. No service zone, hub, partner, rate card or driver is activated as part of this implementation.

## 3. Authoritative recovery context

The execution resolver must identify a recovery continuation from persisted relations, not caller-supplied booleans:

- the delivery leg is exactly `HubIntakeDisposition.nextDeliveryLegId`;
- the disposition decision is `CONTINUE_DELIVERY` and its status is the approved route state;
- the disposition's intake record is still physically `RECEIVED` at the recorded recovery hub;
- the disposition points to the same booking, source leg and recovery hub as the intake/recovery records;
- the source leg is `FAILED` with the D2 supersession reason, not completed;
- the new leg's hub/zone endpoints and type exactly match the approved disposition;
- the booking remains paid and non-terminal;
- the original accepted quote exists and its package facts still match the current booking packages.

A missing, inconsistent, released, cancelled or superseded disposition must fail closed. Do not infer recovery authorization from `deliveryLeg.metadata` alone.

## 4. Predecessor exception — narrow and explicit

Ordinary legs continue to require their immediately preceding leg to be `COMPLETED` with `completedAt`.

A D2 continuation leg may pass that predecessor check only when the immediately preceding leg is the exact `sourceDeliveryLegId` on its approved disposition, is `FAILED` for `HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED`, and the disposition/intake linkage is valid. This exception does not mark the source leg completed and must not apply to any other failed or cancelled predecessor.

The continuation leg remains blocked from transit until the existing two-party hub-to-executor custody handover is confirmed. Assignment and physical release are distinct transitions.

## 5. Route-specific internal execution assessment

Use the accepted booking's current package facts, cross-checked against the package measurements pinned by the accepted quote. Do not copy the original route topology into the new leg.

### Partner-executed continuation

For `HUB_TRANSFER` and `INTERSTATE_TRANSPORT`:

- Query active partner rates for the exact directed origin/destination service-zone pair and `PARCEL_DELIVERY`.
- Require an active rate card and agreement within their effective windows, matching booking currency, and an ACTIVE, VERIFIED partner.
- Match every package by canonical category, whole-gram weight and all dimensions constrained by the rate.
- Require exactly one matching rate per package within a single rate card. Missing or overlapping coverage blocks the candidate; do not choose an arbitrary cheapest/newest rate.
- Sum internal cost with BigInt and expose decimal-string amounts.
- Preserve partner ID, agreement ID, rate-card ID/version, per-package rate IDs and cost total in the immutable executor assessment/snapshot.

The existing partner-rate data model is directed by service-zone pair and can support both partner leg types. This does not make the customer-facing `HUB_PAIR` tariff applicable to `HUB_TRANSFER`.

### Platform-driver final mile

For `FINAL_MILE`:

- Require the destination-zone payout rule coverage for every package.
- Require a verified, non-suspended, FULL-KYC driver, approved final-mile capability, an active verified vehicle approved for that capability, active zone coverage, availability, fresh location and pickup-radius eligibility.
- The selected vehicle and fixed payout must be pinned in the immutable execution snapshot.
- Revalidate the exact driver, vehicle and payout rules before assignment/offer acceptance.

No driver may be selected for `HUB_TRANSFER` or `INTERSTATE_TRANSPORT`.

## 6. Snapshot and assignment lifecycle

Reuse the existing immutable `DeliveryLegExecutionSnapshot` as the selected-executor record; do not create a parallel executor registry.

The snapshot must preserve:
- recovery disposition ID and source delivery-leg ID in its assessment provenance;
- exact new route endpoints, hub IDs, coordinates and leg type;
- package IDs, categories, weights and dimensions;
- selected executor type and ID(s);
- partner agreement/rate-card/version and per-package rates, or driver payout-rule versions and vehicle;
- internal execution cost and currency;
- assessment timestamp and the idempotency payload hash.

Selection is ADMIN-only and idempotent. Reusing the same key and payload replays the same snapshot; same key with a different payload conflicts. Conflicting active offers/assignments block reselection.

After selection, the leg may become `READY_FOR_ASSIGNMENT`. Partner assignment or driver-offer creation must re-read the recovery disposition and rerun the same execution assessment inside its transaction. The assignment must reference the selected immutable snapshot and exact selected executor. Stale agreement, rate card, payout rule, driver, vehicle, hub, capacity, zone, package or route state blocks assignment.

## 7. Custody release gate

The existing two-party custody flow remains the only physical release mechanism:

1. D2 disposition is approved.
2. D2B assesses the new route and selects an executor.
3. The exact selected partner assignment or driver assignment exists.
4. An authorized hub operator initiates handover from the recovery hub to that exact assigned executor on `nextDeliveryLegId`.
5. The receiving executor independently confirms receipt.
6. Only then may the intake and disposition become `RELEASED` and the continuation leg proceed into transit.

Handover initiation must reject a party that is not the executor assigned to the approved continuation leg. Confirmation must revalidate the same assignment and disposition under transaction locks. Generic custody routes must not bypass this gate.

## 8. Required regression coverage

- A normal HAT leg continues to use the accepted quote route-snapshot rules unchanged.
- A D2 continuation is recognized only through its persisted approved disposition and exact next-leg relation.
- Missing, mismatched, cancelled, already released or altered disposition context blocks assessment and selection.
- The failed source leg is accepted only for the exact D2 supersession reason; arbitrary failed predecessors remain blocked.
- Same-state hub continuation resolves `HUB_TRANSFER` partner rates; cross-state hub continuation resolves `INTERSTATE_TRANSPORT` partner rates.
- Same-state final-destination continuation resolves `FINAL_MILE` payout and driver eligibility.
- Exact directed route, package coverage, currency, effective dates, partner status, agreement, rate-card version, weight and dimensions are enforced.
- Missing/ambiguous partner rates and missing/ambiguous payout rules fail closed.
- Same-key replay and conflicting-key payload behavior are deterministic.
- Partner assignment and driver offer creation revalidate the selected snapshot transactionally.
- Hub handover rejects a non-selected executor, wrong leg, missing assignment, wrong hub or stale disposition.
- Intake/disposition remain `RECEIVED`/approved until two-party confirmation; only confirmation releases custody.
- Customer quote and payment amounts remain unchanged; no new charge, payout, payable, refund or settlement is created by assessment/selection.
- Existing D1/D2, HAT, partner execution, local dispatch and custody tests remain green.
- PostgreSQL migration, uniqueness, immutability and transaction/race tests pass where schema or concurrency behavior changes.

## 9. Delivery order

1. **Implemented in draft PR #184:** persisted recovery-context loading and the narrowly scoped failed-predecessor exception.
2. **Implemented in draft PR #184:** recovery-specific package/route assessment and immutable executor-snapshot route provenance.
3. **Implemented in draft PR #184:** partner assignment and local-driver offer/acceptance revalidation using the selected snapshot.
4. **Implemented in draft PR #184:** custody handover initiation and confirmation require the exact executor and vehicle/partner pinned by the snapshot.
5. **In progress:** complete edge-case, same-state `HUB_TRANSFER`, final-mile, assignment-race and PostgreSQL regression coverage; keep OpenAPI unchanged unless a public contract actually changes.
6. **Complete:** CI passed on the PR head; code review and user merge approval remain.
7. **Deferred:** staging acceptance. D2B is not operationally accepted until exercised against an isolated, working staging database after Neon is provisioned.

**Current decision:** D2B backend implementation is ready for review, not a staging or production release. Neon provisioning, frontend recovery workflows and staging acceptance remain external prerequisites for operational verification.

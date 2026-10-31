# Phase 3A.3 — Route-level authorization coverage

**Status:** Initial route-level regression suite added; policy unchanged.  
**Baseline:** merged Phase 3A.2 source on `main`, 31 October 2026.

## Coverage added

`test/phase-3a3-route-authorization.test.js` exercises mounted route factories with injected authentication and role middleware. It verifies:
- The selected administrative routes reject unauthenticated requests.
- The selected administrative routes reject CUSTOMER before request validation or service execution.
- SUPPORT remains accepted on the support queue, while remaining denied on ADMIN-only reconciliation, geography and partner-settlement surfaces.

The route set covers support, refund review, payout review/settlement, reconciliation, geography, service zones, custody administration, partner membership/assignment administration, operational cases and partner settlement.

## Service-layer adversarial coverage added

The custody service suite now verifies that:
- Users without active hub membership cannot list hub intakes, handovers or dispatchable legs.
- A hub operator cannot query another hub by supplying its ID.
- Repository reads are constrained to the caller's active hub memberships.
- Non-members cannot initiate hub handovers or report hub operational exceptions; the service rejects before reading or locking the target delivery leg.

These tests exercise service authorization and data-scope predicates, rather than only route middleware.

## Important limits

This is route-guard regression coverage, not a substitute for service-level object ownership and membership tests. In particular:
- Custody and hub-operation routes without an ADMIN role guard still depend on service-layer party, membership and object-scope authorization. Those need separate adversarial tests.
- The test deliberately does not decide whether SUPPORT should retain payout-settlement confirmation or refund-review authority. Existing grants are preserved.
- The suite does not establish that every privileged mutation is audited; see `docs/admin-audit-coverage.md`.
- The test injects lightweight auth/role middleware to isolate route wiring. Authentication token/session behavior remains covered by the auth middleware tests.

## Remaining Phase 3A governance work

1. Decide whether SUPPORT may confirm payout settlement and review refunds.
2. [x] Define a system-originated audit convention using the existing nullable actorUserId field; webhook refund transitions now emit SYSTEM audit events in the same transaction (Phase 3A.4).
3. [x] Add service-layer adversarial tests for custody/hub membership and ownership boundaries (merged in PR #48).
4. Review audit storage immutability, retention/export and correlation-ID propagation.

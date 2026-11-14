# ER-05 — Staging execution acceptance runbook

**Status:** Runbook prepared; staging execution has not been performed.  
**Scope:** Controlled acceptance of ER-01–ER-04 behavior on the isolated Logistic Hub staging environment.  
**Production impact:** None. This runbook does not authorize production access, deployment, migrations, payment activation, payout activation or service-zone activation.

## 1. Acceptance objective

Demonstrate that the merged execution-readiness implementation behaves correctly against the deployed staging application and its dedicated PostgreSQL database—not merely through unit tests or CI doubles.

The acceptance run must prove that:

- Each delivery leg is assessed against its own accepted route and package facts.
- Local-driver and partner-executed legs use the correct independent eligibility and cost sources.
- A previously valid assessment or executor selection cannot bypass changed eligibility, agreement, rate-card, hub-capacity or route conditions.
- Executor snapshots remain immutable and idempotent under replay.
- Later legs remain blocked until the immediately preceding leg is completed.
- Customer-facing responses do not disclose internal executor identities, snapshots, partner costs or payout provenance.
- No payment, driver payout, partner payable or settlement transfer is created.

## 2. Preconditions — do not start until all are true

| Prerequisite | Required evidence | Current known position |
|---|---|---|
| Staging backend is isolated from production | Render service identity and staging API URL | Previously documented as dedicated staging service |
| Staging database is isolated | Dedicated Prisma database identity; confirm connection target without exposing credentials | Previously documented as dedicated staging database |
| Latest ER code is deployed to staging | Render deployment reports the exact accepted main commit or later | Must be rechecked after PRs #177–#182 are on main |
| Database migrations are current | Deployment logs plus read-only migration status | Must be rechecked |
| Admin identity is provisioned and verified | Successful staging Admin login; no token/password in evidence | Earlier staging record says Admin account was not yet provisioned |
| Browser origin and CORS are configured | Exact staging frontend origin and successful preflight/auth requests | Earlier staging record says CORS/frontend were not configured |
| Test data is isolated and synthetic | Inventory of dedicated test users, partners, drivers, hubs, zones and bookings | Must be prepared; no production data |
| Financial side effects are disabled | PAYMENTS_ENABLED=false, REFUNDS_ENABLED=false; verify no payout/settlement workers or provider credentials are activated | Earlier staging record says payments/refunds disabled |
| Evidence capture is available | Timestamped request/response, audit-event and database-query capture with secrets redacted | Must be prepared |

**Stop conditions:** Any uncertain environment identity, production database connection, unknown deployment commit, missing Admin authorization, or unexpected financial-provider configuration blocks the run. Do not “work around” a blocker by weakening authentication, changing production settings, or enabling payment/payout functionality.

## 3. Test-data design

Use synthetic records created only in staging. Use explicit names/IDs in the evidence log, but do not include personal data, passwords, tokens, API keys or full connection strings.

Prepare at minimum:

1. One synthetic customer and one separate ADMIN account.
2. Active origin and destination service zones with valid geography.
3. One active verified local driver, approved active parcel vehicle, fresh location, required capabilities and an effective payout rule for the applicable local leg.
4. One active verified transport partner, active agreement and active rate-card version covering every package on the exact directed route.
5. Origin and receiving hubs with active parcel service, verified operators, accepted parcel category and sufficient receiving capacity.
6. A synthetic multi-leg booking whose accepted route is pinned as local pickup → interstate transport → final mile, with complete package measurements and a valid accepted quote snapshot.

Do not invent customer tariffs, partner rates or driver payouts for the test. Configure only explicitly approved synthetic staging values, record their provenance and use integer minor units. Do not copy production commercial data.

If the current staging data model or API cannot create these prerequisites through supported Admin workflows, record the exact blocker and stop that scenario; do not write ad hoc SQL to manufacture a passing result.

## 4. Execution procedure

For every case, capture: test ID, staging deployment commit, UTC timestamp, actor role, HTTP method/path, request correlation ID, expected result, actual status/result, relevant audit event IDs and a redacted evidence reference.

### A. Baseline and per-leg readiness

| ID | Action | Expected result |
|---|---|---|
| ER05-STG-01 | Assess the first local-pickup leg | Ready only when its origin-zone payout rule, driver, vehicle, location and route prerequisites are valid |
| ER05-STG-02 | Assess the interstate partner leg | Ready only when the exact directed route has complete partner agreement/rate-card coverage and required hubs are eligible |
| ER05-STG-03 | Assess the final-mile leg before predecessor completion | Blocked; a later leg must not become executable ahead of its predecessor |
| ER05-STG-04 | Remove or expire one required package rate / payout rule in a disposable scenario and reassess | Explicit blocker; no fallback to customer tariff or an unrelated route/rule |
| ER05-STG-05 | Reduce receiving-hub capacity below the incoming requirement and reassess | Blocked with the capacity reason; no bypass based on the earlier assessment |

### B. Executor selection and idempotency

| ID | Action | Expected result |
|---|---|---|
| ER05-STG-06 | ADMIN selects the eligible local executor using a fresh idempotency key | One immutable execution snapshot is created for that leg |
| ER05-STG-07 | Replay the identical selection with the same idempotency key and payload | Successful replay of the original result; no second snapshot or audit mutation |
| ER05-STG-08 | Reuse that idempotency key with a different executor payload | Conflict (IDEMPOTENCY_KEY_REUSED); original snapshot remains unchanged |
| ER05-STG-09 | Attempt selection as CUSTOMER or SUPPORT | Forbidden; no snapshot or privileged audit mutation |
| ER05-STG-10 | Attempt to update or delete a persisted execution snapshot through supported application paths | Rejected; history remains unchanged |

### C. Revalidation at the assignment boundary

Use separate disposable scenarios so each invalidation is attributable.

| ID | Change after selection | Expected result |
|---|---|---|
| ER05-STG-11 | Suspend selected driver or invalidate required KYC/capability | Assignment/acceptance is blocked |
| ER05-STG-12 | Make selected driver's location stale or vehicle ineligible | Assignment/acceptance is blocked |
| ER05-STG-13 | Suspend partner or expire its agreement | Partner assignment is blocked |
| ER05-STG-14 | Retire/deactivate the selected rate card or change effective coverage | Partner assignment is blocked; accepted historical facts are not rewritten |
| ER05-STG-15 | Change route/package facts or invalidate a required hub/capacity prerequisite | Assignment is blocked by fresh transactional revalidation |

Do not mutate shared baseline records in a way that contaminates subsequent cases. Restore by creating new approved versions/records or rebuild the disposable fixture, preserving immutable history.

### D. Multi-leg progression

| ID | Action | Expected result |
|---|---|---|
| ER05-STG-16 | Attempt to progress leg 2 while leg 1 is incomplete | Blocked |
| ER05-STG-17 | Complete the first leg through its supported operational lifecycle and reassess leg 2 | Leg 2 may become ready only if all its own prerequisites still pass |
| ER05-STG-18 | Attempt to progress leg 3 while leg 2 is incomplete | Blocked |
| ER05-STG-19 | Complete leg 2 and reassess leg 3 | Leg 3 may become ready only if its own local-driver and payout requirements pass |

A manually edited status is not acceptable evidence of lifecycle progression. Use the supported operational actions and their normal authorization/custody requirements.

### E. Privacy and financial isolation

| ID | Actor/action | Expected result |
|---|---|---|
| ER05-STG-20 | CUSTOMER reads their booking and delivery-leg progress | Customer-visible progress and customer charges only; no internal snapshot, executor IDs, partner assignment, payout or partner execution cost |
| ER05-STG-21 | SUPPORT reads the same operationally relevant customer view | No ADMIN-only operational-trip partner projection |
| ER05-STG-22 | ADMIN reads permitted operational details | Only the explicitly authorized operational fields are visible |
| ER05-STG-23 | Inspect payment, payout, payable and settlement records before/after the run | No new payment, payout, partner payable or settlement transfer created by ER acceptance |

## 5. Evidence and result classification

Store evidence in the approved private staging evidence location. Redact bearer tokens, cookies, verification tokens, passwords, API keys, connection strings, personal addresses and phone numbers.

For each test, record one of:

- **PASS** — expected behavior observed with reproducible evidence.
- **FAIL** — behavior contradicts the expected result; include a minimal reproduction and correlation/audit IDs.
- **BLOCKED** — prerequisite or environment limitation prevented execution; name the exact blocker.
- **NOT RUN** — not attempted; do not count as pass.

Attach read-only database evidence only where necessary to prove immutable snapshot count/version, audit persistence and absence of financial side effects. Never modify production or staging data with ad hoc SQL to force a result.

The final acceptance report must include:
- exact staging backend deployment commit and deployment ID;
- staging database identity (non-secret identifiers only);
- migration status;
- test-data inventory and cleanup/disposition;
- results for ER05-STG-01 through ER05-STG-23;
- links/IDs for redacted request, audit and database evidence;
- all failures and blockers;
- explicit confirmation that payment, payout and settlement activation remained disabled.

## 6. Cleanup

After acceptance, disable or suspend synthetic test users, drivers, partners and hubs through supported administrative workflows; close or clearly label test bookings; retain immutable snapshots and audit events as evidence. Do not delete immutable execution history to make the environment appear clean. Keep test service zones inactive unless separately approved for operational use.

## 7. Release decision

ER-05 staging acceptance is complete only when every mandatory scenario is PASS, all environment preconditions are evidenced, no unexplained financial side effect exists, and the acceptance report is reviewed.

Any BLOCKED or NOT RUN mandatory scenario means ER-05 remains incomplete. CI success, mocked service tests and PostgreSQL constraint tests are necessary evidence but do not substitute for this staging run.

**Current decision: NOT ACCEPTED — runbook only.** The previously recorded staging state had no provisioned Admin account, no staging frontend/CORS acceptance and disabled email delivery. Those blockers must be independently rechecked and resolved before browser-based acceptance. This document does not assert that staging is currently in that same state.

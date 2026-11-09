# DRV-05C — Admin Safety Holds and Custody Recovery

**Status:** Phase opened on `feat/drv-05c-admin-safety-holds-custody-recovery`. This document records the source audit and acceptance contract before changing assignment/custody state. No API, schema, or migration is included in this planning commit.

## Why this phase exists

DRV-05B deliberately allows the same assigned driver to finish delivery after eligibility changes post-pickup, to avoid stranding parcels. That continuity rule is appropriate for routine eligibility drift (for example, a document expiring while en route), but it is not an adequate response to a credible safety/security incident. Admins need an explicit execution hold and a controlled recovery path.

## Existing source contracts verified on `main`

- `DriverAssignment` binds a driver profile, optional exact vehicle, parcel/ride booking and optional delivery leg. Assignment statuses do not include a hold status.
- `OperationalCase` already supports critical priority, parcel booking, delivery-leg, custody-handover links, assignment to Admin/Support, and case audit events.
- `OperationalAuditEvent` records actor, entity, action, reason, before/after and metadata.
- Assignment execution checks run in serializable transactions at pickup arrival and pickup verification. Post-pickup progression currently follows the DRV-05B continuity rule.
- Custody handovers support sender/driver/hub/partner/recipient parties, but a driver party must be verified and have an active assignment on the leg. Existing custody handover creation does not itself reassign a driver assignment.
- Admin operational cases can be listed and updated, but there is no dedicated assignment execution hold or recovery operation.
- The existing operations-control overview counts active/critical/unassigned operational cases; it does not expose held assignments.

## Non-negotiable safety rules

1. **Hold is distinct from assignment status.** Do not overload `AssignmentStatus` with `ON_HOLD`; retain the assignment's lifecycle status and model the hold explicitly.
2. **No silent reassignment.** Never replace `driverProfileId` or `vehicleId` behind the driver's/customer's back, and never infer a substitute vehicle.
3. **No custody teleportation.** Reassignment cannot by itself claim the new driver has the parcel. Require an auditable physical custody handover (or an authorized recovery exception with evidence and reason).
4. **No unsafe completion bypass.** A safety hold must not be bypassed by DRV-05B's ordinary in-custody continuity exception.
5. **No stranding.** A post-pickup hold must create/attach a critical operational case and expose a recovery-required state. It must not automatically cancel the booking or release the parcel to matching.
6. **Idempotent admin actions.** Repeated hold/release requests must not create duplicate state transitions or audit records.
7. **Reason and actor are mandatory.** Hold, release, recovery, and reassignment require an authenticated Admin, a meaningful reason, and an audit event in the same transaction as the mutation.
8. **Least privilege.** First release is Admin-only. SUPPORT may triage/assign cases but cannot place/release safety holds or authorize custody recovery unless a separate explicit permission is approved.
9. **No customer money side effects.** This phase must not auto-refund, cancel seller payout, adjust fare, or settle a dispute. Financial decisions remain in their own workflows.
10. **No production deployment or migration from this branch.** Schema changes, if justified by implementation, require a reviewable migration and normal CI/staging acceptance.

## Planned implementation slices

### DRV-05C-A — Execution hold primitive
- Admin can place a hold on a specific active parcel assignment.
- Hold reason, actor, timestamp and linked operational case are persisted.
- Hold creation and critical operational-case linkage are atomic.
- Driver arrival/start/destination progression and pickup/delivery verification must respect the hold consistently.
- If a hold is applied after pickup, the assignment is flagged as recovery-required; ordinary DRV-05B delivery completion cannot override it.
- Repeated hold is idempotent; release requires explicit reason and Admin authority.
- List/detail APIs and operational overview expose held/recovery-required work.
- Driver-facing response uses stable error code `ASSIGNMENT_EXECUTION_HELD`; client UI must explain that Admin operations are handling the shipment, without exposing internal incident details.

### DRV-05C-B — Controlled custody recovery
- Admin opens/updates a recovery case and identifies a qualified replacement driver/vehicle.
- Replacement eligibility is revalidated against DRV-05A/05B contracts, route coverage, KYC, capability, vehicle suitability and service zones.
- Existing driver assignment is not simply overwritten. Model the handoff explicitly and preserve the original assignment history.
- A physical custody handover is required between the actual custody holder and replacement operator, with condition/evidence and two-party confirmation where feasible.
- If the current holder is unavailable or unsafe, define a separate Admin-authorized exception with mandatory evidence, reason, incident case and audit trail; do not pretend two-party confirmation occurred.
- Only after custody recovery is confirmed may the replacement assignment become executable.
- Ensure booking/leg state and customer tracking remain coherent and no double-active driver assignment exists.

### DRV-05C-C — Alerting and operational acceptance
- Detect assignments that become ineligible before pickup and create/attach operational cases without duplicate case spam.
- Notify Admin/Support through existing notification/outbox mechanisms, with severity and safe metadata.
- Add Admin queue filters for held/recovery-required assignments and case-linked actions.
- Staging scenarios cover normal eligibility drift, serious incident hold, hold before pickup, hold after pickup, duplicate admin calls, failed handover, recovery completion, unavailable current holder, and audit review.

## Acceptance gates

- A hold cannot be applied to completed/cancelled assignments.
- A held assignment cannot progress through driver actions or verification code consumption.
- A pickup hold prevents custody transfer.
- A post-pickup hold blocks ordinary driver progression/completion until recovery is explicitly resolved.
- Hold/release/recovery transitions are transactional, serializable where concurrent assignment/custody mutations are possible, and audited.
- Customer-facing status remains truthful; no fabricated handover, driver, or delivery timestamp.
- Existing DRV-05B continuity behavior remains unchanged for assignments without a safety hold.
- Existing ride assignment behavior remains unchanged.
- No payment, refund, payout, or seller settlement behavior changes.
- CI and migration checks pass; staging acceptance is required before production use.

## Open engineering decision

The source audit confirms that the existing custody handover model is not itself a driver reassignment mechanism. The implementation must preserve this distinction. DRV-05C-B will not be considered complete until it proves how the assignment history, active driver reservation, vehicle binding, and physical custody handover move together without creating a window in which two drivers can claim the parcel.


## DRV-05C-A implementation snapshot

Implementation is now in the stacked branch `feat/drv-05c-a-assignment-safety-holds`:

- Added explicit nullable hold metadata to `DriverAssignment`: `executionHoldAt`, `executionHoldReason`, `executionHoldActorUserId`, and `executionHoldOperationalCaseId`. Assignment lifecycle status remains unchanged.
- Added `SAFETY_INCIDENT` to `OperationalCaseType`; Admin hold creates a CRITICAL operational case linked to the parcel booking and delivery leg.
- Admin endpoints (ADMIN-only):
  - `POST /api/v1/assignments/admin/:assignmentId/execution-hold`
  - `POST /api/v1/assignments/admin/:assignmentId/execution-hold/release`
  - Both require a reason (5–1000 characters).
- Hold placement is a serializable transaction with retry on Prisma `P2034`: creates the case, writes hold metadata, revokes active booking verification tokens, and records `OperationalAuditEvent` together.
- Hold/release are idempotent where appropriate. Repeated hold returns the existing hold/case without duplicate case/audit. Release clears active hold metadata but keeps the incident case and audit history.
- Assignment driver transitions, pickup/delivery verification, and verification-code issuance reject held assignments with `ASSIGNMENT_EXECUTION_HELD`. Hold check happens before token lookup/consumption, so a held parcel cannot be picked up or delivered through the ordinary verification path.- Ordinary custody handover creation and confirmation are also blocked when either involved driver assignment is safety-held, including a pending handover created before the hold. Verification-code issuance is serialized with the hold transaction using an assignment row lock, preventing a code from being minted after a hold commits.
- Driver assignment list exposes only a boolean `executionHeld`; it does not leak the Admin's incident reason.
- Operations overview now counts `heldParcelAssignments`.
- Safety holds are parcel-only in this initial slice. Ride assignments are explicitly excluded.
- This is **not** custody recovery yet. Release resumes the existing assignment only after Admin review. DRV-05C-B still needs a separate physical handover/recovery mechanism for a current driver who cannot safely continue.

### Migration

`prisma/migrations/20261109090000_drv_05c_assignment_execution_holds/migration.sql` adds the hold columns/index and `SAFETY_INCIDENT` enum value. Validate Prisma schema, migration application/history, and schema drift in CI before merge.

### Remaining acceptance before merge

- CI must pass on the latest PR head.
- Verify Admin endpoint role middleware and validation, API error mapping, and tests for hold/release idempotency.
- Run existing assignment, custody, operational-case and payout tests. No payment/payout state is changed by hold/release.
- Staging test: hold before pickup, hold after pickup, attempted pickup/delivery code, release, and case/audit inspection.

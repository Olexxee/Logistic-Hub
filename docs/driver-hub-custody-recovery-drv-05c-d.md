# DRV-05C-D — Controlled Hub Custody Recovery

**Branch:** `feat/drv-05c-d-hub-custody-recovery`  
**Phase status:** D1 merged in PR #130; D2 backend implementation in progress on `feat/drv-05c-d2-hub-disposition-route-continuation`; staging acceptance pending  
**Scope:** Backend-first safety recovery into an approved, active hub.

## Why this phase exists

DRV-05C-B provides controlled driver-to-driver custody recovery. It does not cover the case where the safety-held driver cannot safely continue and a replacement driver is not the immediate safe custodian. A hub can receive and store the parcel while operations determine the next route.

The repository already has `HubIntakeRecord`, capacity enforcement, accepted parcel-type checks, hub operator membership, and two-party custody handovers. This phase must reuse those foundations rather than create a second inventory/capacity system.

## D1 — Admin-authorized hub intake from a safety-held assignment

### Initiation

An Admin may initiate a hub recovery only when:

- The source is a parcel `DriverAssignment`, not a ride assignment.
- The assignment is in physical custody (`pickupAt` is set and status is `PICKUP_CONFIRMED`, `IN_PROGRESS`, or `ARRIVED_AT_DESTINATION`).
- An active safety hold and its linked `SAFETY_INCIDENT` operational case still exist.
- The selected hub is active and in one of the source leg's service zones (origin or destination zone); it is not required to be the originally planned destination hub.
- No other active driver-to-driver or driver-to-hub recovery exists for the source assignment.

The Admin must supply a meaningful reason. Initiation records authorization; it does not claim that the parcel has physically moved.

### Physical receipt

An active, verified hub operator for the selected hub confirms physical receipt. Confirmation must:

- Re-lock and re-read the recovery, source assignment, delivery leg, hub, and capacity inside one serializable transaction.
- Reconfirm the source remains safety-held and in custody.
- Require measured positive weight and receipt condition; require all dimensions together when supplied.
- Enforce active hub status, accepted parcel category, duplicate active intake prevention, parcel-count capacity, weight capacity, and volume capacity using the existing hub intake policy.
- Create the existing `HubIntakeRecord` and link it to the recovery.
- Mark the source assignment `FAILED` with a recovery reason, clear only the active hold fields, and retain the incident case and full audit trail.
- Leave the delivery leg and booking in their existing in-transit state. The system must not claim the leg completed merely because a recovery hub accepted the parcel.

### Safety and financial boundaries

- No driver identity or vehicle is silently replaced.
- No replacement driver assignment is created in D1.
- No automatic next-leg activation, route rewrite, customer cancellation, refund, payout, fare adjustment, partner payable, or seller settlement occurs.
- Source assignment payout remains under review; recovery receipt is not proof that the source driver completed the contracted delivery.
- The safety incident case remains open for operational disposition.
- Cancellation is permitted only before hub receipt; cancelling does not release the source assignment's safety hold.
- Duplicate requests are idempotent; a different active hub selection conflicts.
- Every authorization, receipt, and cancellation is audited.

## D1 implementation pushed

The backend implementation adds `DriverAssignmentHubRecovery` as an authorization/receipt lifecycle record and links it to the existing `HubIntakeRecord`. The source assignment, parcel booking, delivery leg, selected hub and safety incident remain explicitly linked.

Routes:

- `POST /api/v1/admin/assignments/:assignmentId/hub-recoveries` — Admin authorization.
- `GET /api/v1/admin/assignments/hub-recoveries` — Admin recovery queue.
- `POST /api/v1/admin/assignments/hub-recoveries/:recoveryId/cancel` — cancel before receipt.
- `POST /api/v1/hub-operations/hub-recoveries/:recoveryId/receive` — active hub operator confirms physical receipt.

Receipt revalidates the source assignment and linked safety case under serializable transaction locks, enforces hub service-zone/category/capacity rules, creates the intake record, marks the source assignment failed with payout review required, and clears only the active hold timestamp. The safety incident linkage and hold metadata remain. The booking and leg are not mutated.

CI passed on implementation commit `fbf28c61` (634 passed, 1 skipped, 0 failed). Staging acceptance remains outstanding; this is not a declaration that the phase is complete.

## D2 — Hub-held shipment disposition and route continuation

D2 adds an explicit Admin disposition for a D1 recovery intake. A parcel with no disposition remains physically held; receipt alone never activates a route.

### Decisions and route construction

- `HOLD_FOR_INVESTIGATION` records an auditable hold with a reason. The intake remains `RECEIVED` and no delivery leg is created.
- `CONTINUE_DELIVERY` requires a destination service zone and a reason.
- The recovery hub must still be active, and both origin and destination service zones, their state and country must be active.
- When a destination hub is selected, it must be active, belong to the selected destination zone, differ from the recovery hub, and accept the parcel category. The next leg is `HUB_TRANSFER` when both hubs are in the same state or `INTERSTATE_TRANSPORT` when they are in different states. Both remain partner-executed under the existing policy.
- Without a destination hub, the selected zone must be the booking's final destination zone and be in the same state as the recovery hub. The next leg is `FINAL_MILE` and uses the booking's destination coordinates.
- D2 rejects an existing later delivery leg rather than silently rewriting or skipping a pre-planned route. Such shipments require a separately reviewed route-replan workflow.
- On approval, the superseded source leg is marked `FAILED` with `HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED`; it is never marked completed. A new leg is created from the recovery hub with status `READY_FOR_ASSIGNMENT`.
- The booking remains `IN_TRANSIT`. D2 does not create a driver or partner assignment, negotiate new pricing, create a payable, release payout, refund or settle funds.

### Explicit release gate

The existing hub dispatch, partner assignment and two-party custody workflows are reused:

1. Admin approves a disposition and the next leg becomes eligible for the existing dispatch/partner workflow.
2. A driver or partner must be assigned to that exact leg and reach the existing pickup/acceptance state.
3. Hub staff initiates the existing hub-to-recipient custody handover against the approved next leg.
4. The receiving party confirms. Only then does the intake become `RELEASED` and the disposition become `RELEASED`.

For a D1 recovery intake, both the hub handover creation path and confirmation transaction enforce that the handover leg matches `nextDeliveryLegId` on the approved disposition. A generic custody request cannot bypass the route approval. The D1 safety incident and payout-review flag remain intact.

### D2 API

- `POST /api/v1/admin/hub-intakes/:intakeRecordId/disposition` — Admin records a hold or approves continuation.
- Existing `GET /api/v1/admin/hub-intakes` and `GET /api/v1/hub-operations/intakes` include recovery/disposition state.
- Existing `/api/v1/delivery-legs/:legId/request-matching` / hub matching and partner assignment workflows handle the approved leg; no second dispatch implementation is introduced.

The endpoint is idempotent for an identical already-approved route. A held disposition may be escalated to continuation after review; an approved route cannot be silently replaced.

## Acceptance tests

### D2

- Only Admin can create or change a disposition; non-recovery intakes cannot use this endpoint.
- A recovered intake must still be `RECEIVED`, its booking paid and `IN_TRANSIT`, and its hub active.
- A hold creates no delivery leg and leaves the parcel in hub custody.
- Continuation rejects inactive origin/destination zones, inactive country/state, invalid or non-accepting destination hubs, and cross-state final-mile routes without a destination hub.
- Same-state hub continuation creates a partner-only `HUB_TRANSFER`; cross-state hub continuation creates a partner-only `INTERSTATE_TRANSPORT`; same-state final destination creates a `FINAL_MILE` leg.
- Existing later legs block continuation; the system must not reorder or silently overwrite them.
- Approval atomically fails the superseded source leg, creates exactly one next leg, persists the disposition and writes an audit event.
- Booking remains `IN_TRANSIT`; no assignment, payout, refund, settlement or payable is created.
- Recovery intake cannot be released on any leg other than its approved `nextDeliveryLegId`, including through the generic custody endpoint.
- Releasing custody requires the existing two-party handover confirmation; only confirmation changes intake/disposition to `RELEASED`.

- Reject non-parcel, non-held, pre-pickup, terminal, or unlinked-safety-case assignments.
- Reject inactive hubs, hubs outside both source-leg service zones, and hubs that reject the parcel category.
- Reject a second active recovery or a conflicting active recovery path.
- Only an active hub member can confirm receipt for that hub.
- Capacity is revalidated under a hub row lock; concurrent receipts cannot overbook count, weight, or volume.
- Reject missing/invalid measured weight, incomplete dimensions, missing receipt condition, and duplicate active intake.
- Receipt atomically links intake, retires the source assignment, clears active hold fields, preserves incident history, and writes audit events.
- No leg completion, next-leg activation, driver payout, refund, or settlement is produced by D1.
- Cancellation before receipt leaves the source assignment held and in custody.

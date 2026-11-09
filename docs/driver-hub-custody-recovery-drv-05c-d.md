# DRV-05C-D — Controlled Hub Custody Recovery

**Branch:** `feat/drv-05c-d-hub-custody-recovery`  
**Phase status:** D1 backend implementation pushed; CI and staging acceptance pending  
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

- `POST /api/v1/assignments/admin/:assignmentId/hub-recoveries` — Admin authorization.
- `GET /api/v1/assignments/admin/hub-recoveries` — Admin recovery queue.
- `POST /api/v1/assignments/admin/hub-recoveries/:recoveryId/cancel` — cancel before receipt.
- `POST /api/v1/hub-operations/hub-recoveries/:recoveryId/receive` — active hub operator confirms physical receipt.

Receipt revalidates the source assignment and linked safety case under serializable transaction locks, enforces hub service-zone/category/capacity rules, creates the intake record, marks the source assignment failed with payout review required, and clears only the active hold timestamp. The safety incident linkage and hold metadata remain. The booking and leg are not mutated.

The current PR remains subject to CI and staging verification. This is not a declaration that the phase is complete.

## D2 — Hub-held shipment disposition and route continuation (separate acceptance slice)

D1 deliberately stops at truthful physical storage. A later slice must define how Admin operations selects/approves a new route from the recovery hub, creates or amends the remaining delivery-leg plan, and enables the existing hub dispatch/partner workflows. It must not infer that the original leg is complete or activate a planned leg whose origin does not match the recovery hub.

## Acceptance tests

- Reject non-parcel, non-held, pre-pickup, terminal, or unlinked-safety-case assignments.
- Reject inactive hubs, hubs outside both source-leg service zones, and hubs that reject the parcel category.
- Reject a second active recovery or a conflicting active recovery path.
- Only an active hub member can confirm receipt for that hub.
- Capacity is revalidated under a hub row lock; concurrent receipts cannot overbook count, weight, or volume.
- Reject missing/invalid measured weight, incomplete dimensions, missing receipt condition, and duplicate active intake.
- Receipt atomically links intake, retires the source assignment, clears active hold fields, preserves incident history, and writes audit events.
- No leg completion, next-leg activation, driver payout, refund, or settlement is produced by D1.
- Cancellation before receipt leaves the source assignment held and in custody.

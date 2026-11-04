# Driver assignment lifecycle hardening

**Implementation status:** DRV-04A is merged in backend PR #93 and DRV-04B reservation concurrency is merged in backend PR #95. DRV-04C expiry/release worker implementation is in PR #96 with CI passed, awaiting merge. DRV-04C explicit cancellation/rejection integration and DRV-04D–DRV-04F remain open. See [Current Implementation Stopping Point](./current-implementation-status.md).

## Assignment transitions

Driver actions are an ordered state machine: `ACCEPTED → ARRIVED_AT_PICKUP → PICKUP_CONFIRMED → IN_PROGRESS → ARRIVED_AT_DESTINATION → COMPLETED`. Pickup and delivery completion are verified separately by one-time owner codes. Skipped, repeated, terminal, or out-of-order transitions return a conflict; repository writes use a status compare-and-set inside the transaction.

## Verification codes

- Codes expire after 10 minutes and are stored only as SHA-256 hashes.
- Issuing a replacement revokes the previous active code for that booking/leg/action and resets the new token's failed-attempt counter.
- A code allows at most five failed guesses. The fifth failed attempt revokes it.
- Successful consumption is a conditional update of the still-active, unexpired token, so concurrent submissions cannot consume the same code twice.
- Failed-attempt increments use compare-and-set against the observed counter to avoid lost updates under concurrent guesses.

## Availability after completion

Completing an assignment increments the driver's completed-job count but does not set `isAvailable=true`. Availability is a driver-controlled state and must not be silently re-enabled by assignment completion. The driver must explicitly go available again, and the availability endpoint continues to enforce online, KYC, suspension and active-assignment rules.

## Operational boundaries

Assignment completion does not complete a hub custody handover. Custody release/receipt remains a separate two-party operational event. Unpaid reservation expiry/release is implemented in PR #96. Automatic release remains blocked whenever a payment attempt exists; payment reconciliation must be implemented before enabling live payments. Explicit rejection/cancellation/failure release integration remains outstanding.

## Migration and rollout

Migration `20261104170000_driver_verification_attempt_limits` adds a non-null counter with a zero default, preserving existing token rows. Apply through the normal reviewed migration workflow; do not run it against production without the release owner approving the deployment and migration window.


## Reservation concurrency invariants

The foundation integrity migration already enforces one active assignment per parcel booking, one active assignment per ride booking, and one active job per driver through partial unique indexes. AWAITING_PAYMENT is an active reservation state; COMPLETED, CANCELLED and FAILED release those uniqueness slots.

The acceptance transaction also uses conditional updates on the driver's availability, selected offer and delivery-leg state. These compare-and-set operations provide early, domain-specific conflict responses; the PostgreSQL unique indexes remain the final integrity boundary if concurrent transactions race past an earlier read.

The DRV-04B disposable-PostgreSQL regression test races:
- Two different drivers attempting to reserve the same parcel booking and delivery leg.
- One driver attempting to reserve two different parcel bookings and delivery legs.

Each race must commit exactly one active assignment and reject the competing insert with a unique-constraint violation. The booking-level invariant is intentionally stronger than a per-leg invariant: one parcel booking cannot have two active driver assignments on different legs at the same time. This preserves sequential leg execution and avoids overlapping driver reservations.

No new index or schema migration is needed for DRV-04B. The existing partial unique indexes are defined in 20261103100000_foundation_integrity_constraints.


## Unpaid reservation expiry and release

A driver reservation has a 15-minute payment window. The embedded API worker polls every 30 seconds and uses a conditional assignment update so concurrent worker instances cannot release the same reservation twice.

For a parcel delivery-leg reservation, expiry marks the assignment FAILED with reason PAYMENT_WINDOW_EXPIRED, returns the delivery leg from AWAITING_PAYMENT to READY_FOR_ASSIGNMENT, expires the accepted delivery-leg offer and records a system booking event. The booking remains awaiting payment so the sender can obtain a fresh offer for the ready leg.

For ride and legacy parcel reservations without a delivery leg, expiry returns the booking to MATCHING, clears the stale proposed fare/customer payable, expires the accepted driver offer and records the same event. The assignment remains in history as FAILED.

Driver availability is restored only when the driver is still online, verified, not suspended, has a fresh location and has no other active assignment. Offline, stale-location or otherwise ineligible drivers remain unavailable. Assignment completion does not automatically re-enable availability.

**Payment safety:** any existing PaymentAttempt blocks automatic expiry, regardless of its current status. A provider may confirm a charge after checkout initialization; releasing the reservation before reconciliation could create a paid booking with no valid driver reservation. When payments are enabled, failed/abandoned attempts need a provider-reconciliation decision before release. The current payments-disabled flow creates no PaymentAttempt, so abandoned unpaid reservations can expire automatically.

The expiry worker runs inside the API process using the same Prisma client. It requires no schema migration or separate Render worker. Both the expiry transaction and payment-attempt creation lock the same driver-assignment row with PostgreSQL FOR UPDATE, then re-read its state. If expiry wins, payment initialization is rejected; if payment initialization wins, the newly created attempt blocks expiry. Conditional updates and transaction rollback protect against concurrent payment settlement or lifecycle changes.

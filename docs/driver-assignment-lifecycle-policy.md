# Driver assignment lifecycle hardening

**Implementation status:** DRV-04A is merged in backend PR #93. DRV-04B concurrency regression tests are being added in a separate PR; DRV-04C through DRV-04F remain open. See [Current Implementation Stopping Point](./current-implementation-status.md). This policy describes intended safeguards and must not be read as proof that every listed lifecycle stage is implemented.

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

Assignment completion does not complete a hub custody handover. Custody release/receipt remains a separate two-party operational event. This change does not introduce automatic expiry/reassignment of unpaid reservations; those require a separate policy and job lifecycle with explicit payment/offer reconciliation.

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

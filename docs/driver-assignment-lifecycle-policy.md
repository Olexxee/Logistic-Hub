# Driver assignment lifecycle hardening

**Implementation status:** DRV-04A is merged in backend PR #93. DRV-04B through DRV-04F remain open; see [Current Implementation Stopping Point](./current-implementation-status.md). This policy describes intended safeguards and must not be read as proof that every listed lifecycle stage is implemented.

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

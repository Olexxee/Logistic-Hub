# Phase 3C — Transport-partner and hub administration

**Status:** Implementation in progress on `feat/phase-3c-partner-hub-admin-integrity`.  
**Baseline:** `main` after merged Phase 3B closeout PR #51.  
**Scope:** Transport-partner lifecycle, partner membership and ownership, agreement/rate-card lifecycle integrity, hub operator governance, and safe hub decommissioning.

## Existing capabilities retained

The baseline already includes:
- Transport partner records and ADMIN-only partner creation/status management.
- Partner agreements, activation/suspension/termination and versioned rate cards.
- Partner membership assignment and membership-scoped partner execution.
- Hub point administration, operator verification, operator membership and hub custody operations.
- Internal partner payable, settlement batch and reconciliation workflows.

Phase 3C hardens those existing modules. It does not introduce duplicate models or parallel route families.

## Acceptance criteria

### 3C.1 Transport-partner lifecycle
- A partner must be VERIFIED before activation.
- CLOSED is terminal; a closed partner cannot be reopened or changed.
- A partner cannot be closed while active memberships, active agreements, active delivery assignments, open payables or unreconciled settlement batches remain.
- Suspension blocks new partner assignments and membership activation, while existing assignments/payables remain visible and must be resolved before closure.
- Partner status changes and partner-scoped creation/assignment operations serialize on the transport-partner row.

### 3C.2 Partner membership and ownership
- Only active, email-verified accounts can be activated as partner members.
- Suspended or closed partners cannot receive newly activated memberships.
- Every partner with an active OWNER membership retains at least one active OWNER; the final owner cannot be demoted or deactivated.
- Membership changes are serialized with partner lifecycle changes.
- Global user-role demotion continues only after checking both partner and hub memberships.

### 3C.3 Agreements and rate cards
- Agreement creation, activation and status changes serialize with the owning partner lifecycle.
- A closed partner cannot receive a new agreement.
- Existing agreement effective-date, verification and single-active-agreement checks remain authoritative.
- Rate-card versioning and publication remain transactional; published rate cards retain immutable version history.

### 3C.4 Hub operator governance and decommissioning
- Only active, email-verified accounts can be activated as hub operators.
- A permanently closed hub cannot receive or reactivate operator memberships.
- Every hub with active MANAGER membership retains at least one active MANAGER; the final manager cannot be demoted or deactivated.
- A hub cannot be permanently closed while active operator memberships, non-terminal delivery legs, received/exception intakes, pending handovers or unresolved operational cases remain.
- Hub closure and hub-scoped intake, handover and exception writes coordinate through a row lock so an operation cannot be created concurrently with permanent closure.
- Suspension remains the immediate operational stop control; permanent closure is a decommissioning action.

### 3C.5 Audit, concurrency and regression coverage
- Human administrative mutations remain audited in the same database transaction as the mutation.
- Partner administrative and membership transactions use SERIALIZABLE isolation with bounded retries for Prisma `P2034` serialization conflicts.
- Partner assignment, partner agreement lifecycle, settlement batch creation and hub-scoped operations coordinate with lifecycle locks.
- Tests cover terminal partner closure, open operational/financial blockers, final partner owner, final hub manager, inactive-account reactivation, hub operator-aware closure and existing authorization boundaries.

## Implemented in this workstream

- Partner status changes use serializable transactions and lock the partner row.
- Closed partners are terminal; closure is blocked by active members, active agreements, active assignments, open payables and open settlement batches.
- Agreement creation, activation and status changes lock the owning partner row.
- Partner assignment and partner membership mutations use serializable transactions and partner row locks.
- Partner owner membership cannot be reduced to zero by demotion/deactivation.
- Hub operator membership mutations use serializable transactions and hub row locks.
- Hub manager membership cannot be reduced to zero by demotion/deactivation.
- Hub closure locks the hub row and requires all operator memberships and operational obligations to be cleared.
- Hub handover initiation and exception reporting lock the delivery leg then hub row; hub intake confirmation already locks the hub row for capacity enforcement.
- Settlement batch creation locks the owning partner row and rejects closed partners.
- Added regression tests for partner closure, membership ownership, hub manager governance, hub closure and settlement batch closure guards.

## Explicitly out of scope / follow-up decisions

- **External partner payouts:** settlement batches are internal accounting and reconciliation records. No bank transfer, Paystack transfer, or external payout execution is enabled by Phase 3C.
- **Partner suspension policy for in-flight work:** existing assignments are not automatically cancelled or rewritten when a partner is suspended. The operational policy for accepting/starting/finishing already-assigned work must be explicitly approved before changing those state transitions.
- **Hub suspension policy for in-flight work:** suspension prevents new hub operations that require an ACTIVE hub; it does not rewrite persisted delivery plans. Reassignment/continuation policy for parcels already in hub custody requires a separate operational decision.
- **Admin pagination/search:** existing partner and hub admin list contracts are not silently changed in this integrity slice. Pagination and filtering should be delivered as a coordinated API/frontend contract change.
- No Prisma schema changes, migrations, production data edits, payment activation or role-grant changes are included.

## Verification checklist

- [ ] Partner and hub service regression tests pass.
- [ ] OpenAPI and mounted-route contract validation passes.
- [ ] Prisma schema/client validation passes.
- [ ] Disposable PostgreSQL migration and schema-drift checks pass.
- [ ] Full API and PostgreSQL integrity suite passes.
- [ ] Review CI before merge; repository owner performs the merge.

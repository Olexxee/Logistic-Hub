# Phase 3C — Transport-partner and hub administration

**Status:** Complete. Merged in PR #52 (merge commit `8564416f5c2835b08bba93dc9a92842115024a90`).  
**Baseline:** `main` after Phase 3B closeout PR #51.  
**Scope:** Transport-partner lifecycle, partner ownership and membership, partner agreements and rate-card lifecycle, delivery assignments, and hub operator governance.

## Acceptance criteria

### 3C.1 Transport-partner lifecycle
- Activation requires VERIFIED status and at least one active OWNER membership belonging to an active, email-verified user.
- Verification cannot be downgraded while a partner remains ACTIVE.
- Partner status transitions are forward-only; ACTIVE or SUSPENDED partners cannot be reset to PENDING.
- CLOSED is terminal; closed partners cannot be reopened or receive new memberships or agreements.
- Suspension and closure are blocked while assignments are ASSIGNED, ACCEPTED or IN_TRANSIT.
- Suspending a partner also suspends its active agreements in the same serializable transaction, auditing each dependent transition.
- Closure is blocked until memberships are inactive, agreements are terminal and all payables are settled or voided.

### 3C.2 Partner ownership and membership
- An active partner retains at least one active OWNER.
- The last active OWNER cannot be demoted or deactivated.
- Membership and assignment lifecycle writes use serializable transactions with bounded retry for Prisma P2034 conflicts.
- Assignment acceptance and start require an active membership and an ACTIVE, VERIFIED partner.
- Closed partners cannot receive new memberships or have membership state changed.

### 3C.3 Agreements and rate cards
- Agreement activation remains restricted to active, verified partners and effective dates.
- Active agreements cannot be suspended or terminated while they have active assignments.
- Partner lifecycle mutations, agreement activation, rate-card version allocation and publication use serializable transactions with bounded retry.
- Rate-card publication requires an eligible active agreement, active verified partner, effective dates and at least one active rate.

### 3C.4 Hub operator governance
- Hub status transitions are forward-only; ACTIVE or SUSPENDED hubs cannot be reset to PENDING.
- Closed hubs cannot receive new operators or have memberships changed.
- An ACTIVE hub must retain at least one active MANAGER membership belonging to an active, email-verified user.
- The last active MANAGER cannot be deactivated while the hub remains ACTIVE.
- Hub activation requires active manager membership in addition to existing coverage, operator verification, opening-hours, parcel-type and capacity checks.

### 3C.5 Audit, authorization and regression coverage
- Administrative endpoints remain ADMIN-only.
- Lifecycle changes and dependent agreement suspension are audited transactionally.
- Regression tests cover suspension blockers, ownership preservation, closed-state restrictions, manager requirements and assignment access after partner suspension.
- OpenAPI and mounted-route parity remain valid; no new public routes or role grants are introduced.

## Explicit scope boundaries
- No schema migration or production data change.
- No payment activation or changes to finance approval permissions.
- No generic administrative override of delivery-leg or assignment status.
- No automatic cancellation or reassignment of in-flight work. Partner suspension/closure is blocked while active assignments remain.
- No change to existing ADMIN-only authority for partner/hub administration.

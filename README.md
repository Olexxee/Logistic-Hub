# Logistic Hub

Logistic Hub is a Nigeria-focused logistics platform for coordinating local parcel delivery and inter-state shipments through verified workers, transport partners and operational hubs.

The platform coordinates the shipment lifecycle: booking, route and capacity checks, quotation, customer acceptance, payment verification, dispatch, custody transfers, delivery confirmation and financial reconciliation. It is designed to expand across Nigerian states through configurable geography, partner agreements and service coverage rather than one-off code changes.

## Product blueprint

### Launch scope and operating principles

- **Initial launch area:** multiple Lagos Local Government Areas (LGAs) from day one.
- **Backend first:** stabilize API contracts, lifecycle rules and tests before expanding client applications.
- **Partner-led inter-state pricing:** negotiated transport-partner agreements are the primary source of rates for covered routes. Logistic Hub does not invent market prices or impose a universal price on independent drivers.
- **Customer price acceptance:** the sender must approve the complete quote before the shipment is committed at that price.
- **Capacity before collection:** for inter-state shipments, confirm a suitable transport option and an acceptable commercial quote before dispatching a local collection agent, unless the sender explicitly agrees to a different arrangement.
- **Payments remain disabled:** no live payment collection, payout activation or production payment configuration without explicit repository-owner approval.
- **Controlled repository workflow:** do not merge changes into `main` without explicit approval.

### 1. End-to-end shipment flow

1. The sender creates a booking with pickup and destination, parcel description, actual weight, dimensions, service needs and contact details.
2. The system checks route coverage, parcel restrictions, provider/worker eligibility and available capacity.
3. The quotation engine selects an active partner rate card when one covers the route, parcel category, service and shipment date. Otherwise, operations obtains an authorized provider quote; the system must not fabricate a rate.
4. The system calculates the complete customer price, including applicable local collection, transport, hub handling, destination delivery and platform charges.
5. The sender accepts a specific quote version. The accepted amount and the pricing inputs used are retained as an auditable record.
6. Payment is requested only after acceptance. In implementation and testing, payment activation remains disabled until explicitly approved; any eventual payment must be verified server-side before dispatch is allowed to proceed.
7. Dispatch creates the required delivery legs and assignments.
8. Each handover records custody and requires confirmation from the receiving party.
9. Delivery is confirmed by the recipient or through an explicitly approved delivery-confirmation process. Disputes and exceptions are handled by operations.
10. Financial records are reconciled separately for customer payments, provider compensation, fees, refunds and payouts.

### 2. Local and inter-state delivery

**Local delivery:** a qualified local delivery agent can collect from the sender and deliver directly to the recipient. A hub is not mandatory simply because a route is long or crosses an LGA boundary. Use a hub only when operationally justified by coverage, route, service, capacity, cost or custody requirements.

**Inter-state delivery:** the preferred flow is local collection → origin hub → contracted long-distance transport → destination hub or approved receiving point → destination-side local delivery when required. A qualified transport provider may perform an end-to-end journey when the route, capability, service terms and economics support it.

Handover may be direct between workers or through a designated hub. Every shipment can have a different number of legs; the system must not hard-code one universal route.

### 3. Core domain model

Keep these concepts separate and link them through explicit identifiers:

- **Parcel booking / shipment:** sender and recipient, origin and destination, parcel details, service type, accepted quote, payment state and overall outcome.
- **Quote and rate agreement:** provider agreement, rate-card version, applicable route and parcel band, itemized charges, total, expiry, adjustments and sender acceptance.
- **Delivery leg:** one segment of a journey, such as local collection, inter-state transport, hub transfer or final-mile delivery. Each leg has its own lifecycle and requirements.
- **Worker assignment:** the responsible worker or provider for a leg, including eligibility checks, offer/acceptance and assignment history.
- **Custody event:** append-only history of who released and received the parcel, time, location, parcel condition, evidence and confirmation.
- **Payment and settlement records:** payment attempts and verified transactions, allocations, provider charges, platform revenue, refunds, payouts and reconciliation.
- **Operational case:** failed handovers, damaged or missing parcels, failed delivery, cancellations, pricing exceptions and disputes.

A single booking status must not be used to represent every leg, hub arrival, custody transfer, payment and settlement state.

### 4. Roles, capabilities and access control

Platform roles and worker capabilities are separate concepts. A user may hold multiple verified capabilities, while each assignment grants responsibility for a specific leg.

Platform roles include:

- **Customer/sender:** create bookings, approve quotes, pay, track shipments and raise disputes.
- **Pickup/local delivery agent:** collect and deliver parcels within approved service areas.
- **Transport driver:** perform eligible transport legs and confirm handovers.
- **Hub operator:** receive, inspect, record custody and perform explicitly delegated dispatch actions.
- **Operations:** coordinate dispatch, route coverage, exceptions, partner rates and operational rules.
- **Support:** handle customer enquiries and disputes within assigned permissions.
- **Administrator:** manage access, configuration, approvals, suspensions and audit oversight.

Worker capabilities may include local pickup, local delivery, inter-state transport and hub handling. A worker must be checked for verified capability, route coverage, vehicle suitability, parcel restrictions and availability for every assignment. Registration payloads must never grant elevated roles or self-verified status. Backend authorization is mandatory.

### 5. Hub operating model

All hubs use one domain model with three ownership types:

1. **Company-operated hubs:** managed by Logistic Hub and staffed by authorized internal personnel.
2. **Partner-business-operated hubs:** operated by a verified business under agreed service and commercial terms, with explicitly authorized staff.
3. **Individual-operated pilot hubs:** allowed only under a restricted pilot with identity and location verification, training, an operator agreement, explicit approval, volume/value limits and frequent review.

A hub record should track its unique ID, ownership model, responsible operator and staff, location, services, operating hours, service areas, parcel restrictions, verification, operational status, delegated permissions and audit history.

Identity verification, location verification and operational authorization are distinct. Passing KYC does not automatically authorize every hub function. Individual pilot hubs begin with parcel intake and custody recording; dispatch permissions may be delegated after operational review.

Central operations retains authority over hub approval, permission delegation, suspensions, exceptional pricing, escalations and audit oversight. Hub operators may perform only the dispatch and pricing actions expressly delegated to them. They cannot override an accepted sender price, assign an ineligible worker or confirm custody on behalf of the receiver.

A hub may also perform a digital dispatch-coordination role without acting as a physical warehouse. The launch does not require a warehouse in every LGA.

### 6. Partner agreements and quotation rules

Partner-agreed transport rates are the primary price source for covered inter-state routes. Agreements should define applicable corridors, parcel categories and size/weight bands, service types, volume expectations, capacity commitments, service standards, custody and claims responsibilities, compensation, validity dates and review terms.

The quotation engine is a **rate-selection and calculation engine**, not an algorithm that dictates prices to independent drivers.

Rate selection follows this order:

1. Find a valid agreement covering the route, parcel category, service and date.
2. Check that the provider has eligible capacity and can meet the required service.
3. Calculate the customer total from applicable transport, collection, handling, destination-delivery and platform charges.
4. If no agreement covers the shipment, require an authorized operations quote or a separately accepted provider offer.
5. Present the full quote and require sender acceptance before committing the shipment at that price.

Do not invent a rate when no agreement or authorized quote exists. A material price change requires a revised quote and renewed sender acceptance. If a parcel is already at a hub, disclose any charges already incurred before asking the sender to accept onward transport.

Keep these financial amounts distinct:

- **Customer charge:** the total sender-approved price.
- **Provider compensation:** the amount owed to the transport company, driver or local agent under their applicable terms.
- **Platform revenue:** approved platform charges and commissions.

A driver operating under a transport company's agreement is not necessarily subject to the same terms as an independently contracted driver. The normal path on agreed routes should not require shipment-by-shipment bargaining; negotiation is a controlled fallback for uncovered routes.

Every quote must preserve the applicable agreement ID and rate-card version, route, parcel measurements, calculation inputs, charges, adjustments, expiry, customer acceptance and timestamps. Later rate-card changes must not silently change accepted bookings. Corrections to measurements or operational pricing inputs must be logged with the old value, new value, reason and responsible operator.

### 7. Geography, routing and service coverage

The geography model must support Country → State → LGA → service zone, with multiple Lagos LGAs enabled at launch and cross-state routes supported by configuration.

Coverage and routing decisions should consider:

- Origin and destination service coverage.
- Active route and partner agreements.
- Worker/provider availability and capacity.
- Verified worker capabilities and vehicle suitability.
- Parcel size, weight, restrictions and service type.
- Estimated route, operating hours, costs and service promise.
- Whether direct delivery or hub-assisted transport is operationally appropriate.

Coverage must be checked per leg. A provider rate does not guarantee capacity, and route distance alone must not determine whether a hub is required.

### 8. Custody, tracking and exceptions

Every custody transfer records the shipment and leg, releasing party, receiving party, timestamp, location, parcel condition, evidence and receiver confirmation. Evidence may include a one-time PIN/QR confirmation and approved supporting media.

PIN/QR confirmations must be validated server-side, bound to the intended shipment and handover, expire or become unusable after completion, and resist replay. The sender, driver or hub operator must not be able to fabricate the receiver's confirmation.

Tracking should distinguish meaningful states such as awaiting collection, collected, arrived at hub, awaiting handover confirmation, in transit, delivery attempted, delivered, disputed and exception review. Failed handovers, unavailable recipients, damage, loss and suspected fraud need an operations exception path. A disputed custody event must not be silently treated as a completed transfer.

### 9. API workstreams

The backend is the source of truth for business rules. Stabilize and document these contracts before substantial client expansion:

1. **Identity and access:** registration, verification, login, session restoration, logout, password recovery, roles and permissions.
2. **Geography and coverage:** states, LGAs, service zones, routes and eligibility.
3. **Workers and partners:** worker verification, capabilities, vehicles, partner onboarding and commercial agreements.
4. **Hubs:** ownership, staff authorization, services, operating status, intake, custody and delegated dispatch.
5. **Bookings and quotations:** booking creation, parcel measurements, rate selection, quote versions, acceptance and expiry.
6. **Dispatch and delivery legs:** capacity checks, assignment offers, acceptance, leg state transitions and re-assignment.
7. **Custody and tracking:** handovers, PIN/QR evidence, shipment timeline and exception cases.
8. **Payments and settlement:** payment verification, ledger, allocation, refunds, payouts and reconciliation. Keep live activation disabled pending explicit approval.
9. **Operations and support:** dispatch oversight, disputes, cancellations, authorized adjustments, audit trails and reporting.

The existing parcel-booking list API work belongs in the booking workstream and should be extended rather than replaced unnecessarily. The existing repository structure, contracts and migrations must be audited before deciding on schema changes.

### 10. Implementation sequence

1. **Repository and schema audit:** establish the actual state of each active branch, models, routes, contracts, migrations and tests. Identify conflicts between existing behavior and this blueprint before changing code.
2. **Identity and authorization:** complete authentication and enforce backend permissions for operational actions.
3. **Geography, workers, partners and hubs:** establish verified participants, service coverage and hub permissions.
4. **Bookings and quotations:** implement partner rate cards, capacity checks, quote acceptance, expiry and immutable accepted-price records.
5. **Delivery legs and custody:** support direct local delivery and hub-assisted inter-state journeys with auditable handovers.
6. **Payment testing:** validate payment and reconciliation flows in test mode only. Do not activate live payments without explicit approval.
7. **Operations and client alignment:** stabilize backend contracts and lifecycle tests before implementing client workflows against them.

Database changes must follow the repository's migration strategy, use new timestamped migrations and preserve integrity constraints. Existing code should be reused where it fits the target model; the blueprint is not a mandate to rebuild working modules from scratch.

### 11. Acceptance criteria

The implementation is not ready for launch until tests demonstrate that:

- A local parcel can be delivered directly by one qualified agent without unnecessary hub transfers.
- An inter-state shipment can pass through approved hubs and an eligible transport partner.
- A valid rate cannot bypass capacity or service-eligibility checks.
- An uncovered route requires an authorized quote rather than a fabricated price.
- An accepted quote remains unchanged after a rate-card update.
- Workers cannot accept assignments outside their verified capability or service coverage.
- Hub operators cannot confirm receipt on behalf of a receiver or override the sender's accepted price.
- Failed or disputed custody transfers create an operations case and block inappropriate state progression.
- Customer payments, provider compensation and platform revenue reconcile independently.
- Unverified workers and hubs cannot perform restricted actions.
- Payment collection and payout activation remain disabled until explicitly approved.
- Changes remain on a reviewable feature/documentation branch until the repository owner approves merging.

### Priority 5 implementation progress

Work is underway on the feature branch feature/priority-5-delivery-legs-custody, stacked on the Priority 4 booking/quotation branch. The first slice adds the parcel delivery-leg model, creates a direct leg atomically when the sender accepts a driver fare, activates it only after server-verified payment, synchronizes leg progress with assignment and one-time verification transitions, and exposes an owner-scoped delivery-leg timeline API. It does not yet implement multi-leg routing, partner assignment, hub custody handovers or operational exceptions. Review the branch CI and pull request before treating this slice as complete.

## Existing technical foundation

The blueprint builds on the repository's existing technical foundation and must be reconciled with actual code before implementation.

- [Technical foundation](docs/technical-foundation.md)
- [Foundation decisions: geography, maps and Paystack split payments](docs/foundation-decisions.md)
- [State machines and matching algorithm](docs/state-machines-and-matching.md)
### Priority 6 implementation progress

The first Priority 6 slice was merged in PR #26. It adds authenticated transport-partner membership, admin assignment of paid interstate delivery legs against the accepted partner agreement, partner acceptance/start transitions, idempotency protection and operational audit events. The accepted quote—not a client-supplied amount—is the source of the partner transport charge.

Priority 6 backend implementation now covers partner assignment/execution, hub custody handovers, operational exceptions, and internal partner settlement/reconciliation. A partner interstate assignment completes only when its destination hub confirms custody; that event creates a payable from the assignment's stored accepted-quote charge. Recipient custody confirmation requires an active account with a verified phone number matching the booking recipient phone. Administrators can record callback, in-person or document-reviewed phone verification outcomes with an audit reason; the platform does not send SMS OTPs. Payables require administrator approval; adjustments require approval by a different administrator; batches are derived from approved payables; reconciliation records matched, variance or disputed outcomes and supporting references. This is an internal accounting workflow only: it does not initiate or confirm provider payouts. Live payments and provider payouts remain disabled.

- [Payment ledger and settlement](docs/payment-ledger.md)
- [Database integrity and migration strategy](docs/database-integrity.md)
- [OpenAPI contract baseline](docs/openapi.yaml)
- [Initial database schema](prisma/schema.prisma)
- [Supplemental PostgreSQL constraints](prisma/constraints/foundation.sql)
- [API contract overview](docs/api-contracts.md)

## Technology and architectural guardrails

- **Backend:** JavaScript ES modules, Node.js and Express.
- **Data:** PostgreSQL and Prisma ORM.
- **Geospatial queries:** explicit PostgreSQL/PostGIS migration for spatial indexes when the deployment database supports the extension.
- **Maps:** provider-neutral server-side adapter; external maps integrations remain disabled by default.
- **Payments:** Paystack may be evaluated for the eventual payment flow, subject to merchant-account capabilities, commercial terms, security and regulatory review. Live payments remain disabled.
- **Background work:** Redis and a queue worker may be added for expiring offers, notifications and retries; PostgreSQL remains the source of truth.
- **Backend module structure:** database/repository layer owns persistence and transactions; services enforce business rules; controllers stay thin; routes apply validation and authorization; asynchronous controllers use the project's async wrapper and centralized error handling.
- **API-first delivery:** clients consume documented contracts; they do not independently define business rules.
- **Database changes:** use additive, timestamped migrations and integrity tests. Do not rewrite an already-applied migration to introduce later changes.

## Current implementation status

This README describes the **target product and technical blueprint**, not a claim that every workflow is already implemented. Authentication, partner agreements, quote versioning, multi-leg dispatch, hub custody, exceptions and complete settlement must be verified against the repository before they are treated as production-ready.

Existing parcel-booking list work is tracked in [PR #8](https://github.com/Olexxee/Logistic-Hub/pull/8). The broader technical foundation has also been tracked in [draft PR #3](https://github.com/Olexxee/Logistic-Hub/pull/3). Check the current PR and branch status before relying on any implementation-status statement.

The initial rollout targets **multiple Lagos LGAs**. The intended commercial sequence is **partner-rate/capacity selection → sender quote acceptance → payment → dispatch**, with authorized quotation fallback for uncovered routes. Maps default to disabled. Payments are hard-disabled and must not be enabled through configuration alone.

**Release guardrails:** do not merge into `main`, apply production migrations, or accept live bookings/payments until implementation, tests, security review and applicable regulatory checks are complete and the repository owner explicitly approves the next step.


## Background email delivery

Transactional email is persisted to PostgreSQL before the API acknowledges the operation. Registration, password-reset and notification flows enqueue encrypted email jobs; they do not call the email provider in the request lifecycle.

### Required configuration

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL`
- `APP_BASE_URL` set to the deployed frontend origin
- `OUTBOX_ENCRYPTION_KEY` set to a base64-encoded 32-byte key. Generate one with `openssl rand -base64 32`. Use the same key for the API service and worker. Keep it stable; rotating it requires a deliberate re-encryption/rotation procedure because pending jobs depend on it.

### Run locally

1. Apply migrations and regenerate Prisma Client: `npx prisma migrate deploy && npx prisma generate`.
2. Start the API: `npm start`.
3. Start the background worker in a second process: `npm run worker`.

### Render deployment

Deploy two services from the same repository and commit:

- **Web Service:** build `npm install`, start `npm start`.
- **Background Worker:** build `npm install`, start `npm run worker`.

Both services must use the same PostgreSQL `DATABASE_URL`, Resend configuration and `OUTBOX_ENCRYPTION_KEY`. Apply the migration before starting either service. The worker uses PostgreSQL row locks with `SKIP LOCKED`, a lease for crashed-worker recovery, provider idempotency keys and exponential retry delays. Jobs are marked `DEAD` after eight failed attempts; inspect `outbox_jobs` and the `lastErrorCode` field for operational recovery. Never log decrypted job payloads or one-time tokens.


## Phase Three — Operations, Administration and Support

**Status: Blueprint approved for implementation planning; not an implementation-completion claim.**  
**Baseline:** `main` at `21fea0517f68e1fa58c005fb8e4def99d0c637c9` (31 October 2026).  
**Implementation rule:** audit and extend the existing modules. Do not recreate APIs or schema that already satisfy the requirements. Keep all work on reviewable feature branches; do not merge to `main` without repository-owner approval.

### Phase Three objective

Deliver a secure operations console API and reliable administrative workflows for managing users, service coverage, transport partners, hubs, shipment exceptions and customer support. Every privileged mutation must be authorized server-side, validated against the relevant domain lifecycle, attributable to an actor, and auditable.

This phase does not authorize live payment activation, external partner transfers, production database migrations, or arbitrary shipment-status overrides.

### Existing baseline confirmed in source

The following are present on the baseline branch. Their presence does **not** mean the complete Phase Three acceptance criteria are already met.

| Capability | Existing implementation | Initial assessment |
|---|---|---|
| Admin user directory | `GET /api/v1/admin/users`; search, role/status filters and pagination in the discovery module | Read-only directory. No verified user-role/permission administration workflow established by this endpoint. |
| Audit events | `GET /api/v1/admin/audit-events`; ADMIN-only router | Read-only audit listing exists. Audit coverage and query/filter controls require a systematic audit. |
| Geography | Admin country/state/LGA routes under `/api/v1/geography/admin` | CRUD/status operations exist; verify deletion constraints, pagination, audit coverage and safe deactivation behavior. |
| Service zones | Admin service-zone CRUD and per-service availability operations | Core controls exist; verify overlap/route semantics, history, audit coverage and effects on active bookings/assignments. |
| Hubs | Hub administration service supports create/update, operator verification review and status changes | Existing operational validation and audit events exist for selected mutations. Verify operator membership lifecycle, delegated permissions, capacity and closure behavior end to end. |
| Operational cases | Admin list/update endpoints with status transitions, priority, assignee and resolution | Core triage lifecycle exists. Verify concurrency, authorization, complete audit history, filters and case creation/linkage from every exception source. |
| Support tickets | Customer create/list and ADMIN/SUPPORT queue/update endpoints | Basic ticket workflow exists. Verify assignment eligibility, transition rules, internal notes, customer-visible replies, escalation and audit trail. |
| Cancellations | Customer-owned cancellation request endpoint | Cancellation policy is service/repository-driven. Verify all booking/fulfilment/payment states and support escalation paths; no automatic refund assumption. |
| Partner administration | Partner pricing and execution modules, agreements, rate cards, quotes and memberships | Significant groundwork exists. Audit partner onboarding/status, membership assignment/revocation, agreement lifecycle and operator access before adding endpoints. |

### Phase Three implementation progress

| Slice | Status | Evidence |
|---|---|---|
| 3A.1 — Route and permission inventory | Implemented on the current work branch; CI validation pending | [Administrative route and permission inventory](docs/admin-route-permission-inventory.md); `test/admin-route-permission-inventory.test.js` |
| 3A.2 — Audit coverage and safe admin mutation primitives | Implementation in progress; CI validation pending | Shared transaction-bound audit writer and mutation coverage across drivers, geography, service zones, hubs, support and finance; see [audit coverage matrix](docs/admin-audit-coverage.md). Partner execution/pricing/settlement, custody and operational cases already have transaction-bound audit paths. System-originated webhook actor design and final route-by-route verification remain open |

3A.1 is deliberately documentation and regression protection only. It does not introduce granular permissions or change current role access.

### 3A — Administrative security and audit foundation

**Purpose:** establish a consistent authorization and audit boundary before expanding administrative powers.

Work:
- Inventory every privileged route and mutation in the existing application, including geography, service zones, hubs, partners, users, operational cases, support, custody and finance.
- Document the current role model and all role checks. Identify where ADMIN-only access is intentional and where ADMIN/SUPPORT or a narrower capability is required.
- Define a permission matrix for actions, not just pages. Candidate capabilities include user read/manage, geography manage, partner manage, hub manage, dispatch intervene, case triage, support manage, finance review and audit read.
- Keep permission checks in backend middleware/services. UI visibility is not an authorization control.
- Do not let an administrator grant their own privileges, elevate another administrator, or remove the last effective owner/admin without a separately approved recovery policy.
- Make privileged mutations record actor, action, entity, timestamp, reason where appropriate, correlation/request ID, and minimal before/after state. Never store passwords, tokens, verification codes, raw payment payloads or unnecessary personal data in audit metadata.
- Add audit coverage for currently unaudited privileged mutations. Audit records should be append-only to application roles; correction is a new event, not an edit to history.
- Add tests for unauthenticated access, role denial, permission denial, cross-tenant/object scoping and audit emission.

**Acceptance criteria:**
- Every privileged route is represented in a permission matrix and tested.
- A user without the exact permission receives a consistent 403 response even when calling the API directly.
- Every successful privileged mutation emits exactly one durable audit event in the same transaction as the mutation where feasible.
- Failed mutations do not emit misleading success events.
- Audit reads are paginated, filterable and restricted; sensitive values are redacted.

### 3B — Geography and service-coverage administration

**Purpose:** make operational coverage configurable without creating invalid or contradictory geography.

Work:
- Verify country/state/LGA and service-zone CRUD contracts, validation and referential constraints.
- Define safe deactivation behavior when a zone has active hubs, workers, assignments or bookings. Do not silently invalidate in-flight fulfilment.
- Verify per-service availability windows, effective dates and parent geography activation rules.
- Define whether zone boundaries/overlaps and route coverage are supported by current data. Do not imply polygon-based coverage if only relational zone membership is implemented.
- Ensure quote/dispatch eligibility consumes the same authoritative coverage rules as the admin console.
- Add audit events for create, update, activation/deactivation and availability changes, including reason and before/after values.
- Add pagination/search where operational datasets can grow; preserve stable sorting and cursor semantics.

**Acceptance criteria:**
- Invalid parent-child geography relationships are rejected.
- A zone cannot be enabled under inactive parent geography.
- Deactivation cannot silently break active assignments or accepted shipments; the service returns a defined conflict or applies an explicitly documented grandfathering rule.
- Booking, quote and dispatch eligibility agree with the admin-configured availability.
- All changes are auditable and covered by integration tests.

### 3C — Transport-partner and hub administration

**Purpose:** provide a controlled lifecycle for commercial providers and physical/digital operating points.

Work:
- Audit existing partner, agreement, rate-card, quote, partner membership and partner execution modules before adding anything.
- Define partner lifecycle states and permitted transitions: onboarding/review, active, suspended and closed, including effects on new assignments versus already accepted assignments.
- Define agreement and rate-card lifecycle rules: effective dates, versioning, route/category scope, expiry, supersession and immutable historical quote snapshots.
- Complete membership administration: add/remove partner operators, verify eligibility, prevent duplicate active memberships, and revoke access promptly when a partner is suspended or membership ends.
- Complete hub operator membership and delegated capability management. Separate operator identity verification from hub activation and permission to perform intake, custody, dispatch or pricing actions.
- Validate hub opening hours, capacity, accepted parcel types, service-zone availability and operator verification before activation.
- Record auditable reasons for partner/hub activation, suspension, closure, verification review and membership changes.
- Preserve accepted quotes and in-flight custody/assignments when a partner or hub is suspended; block new work according to explicit policy rather than rewriting history.

**Acceptance criteria:**
- Only eligible, active partner members can access partner execution operations.
- Suspended/closed partners cannot receive new assignments or quotes; existing work follows a documented safe completion/escalation path.
- Rate-card changes do not alter accepted quote snapshots.
- Hub activation requires active coverage, verified operator details and valid operating/capacity configuration.
- Hub operators can perform only explicitly delegated actions and cannot impersonate a receiver or override customer-approved pricing.
- Membership and lifecycle changes are audited and tested.

### 3D — Operations control centre and exception management

**Purpose:** give operations a reliable view of work requiring intervention without bypassing domain state machines.

Work:
- Audit operational-case creation sources and ensure failed handovers, damage/loss reports, failed delivery, partner delay, route disruption, pricing exceptions and customer disputes create or link to a case consistently.
- Extend case queues with validated filters, pagination, stable sorting, assignment and priority controls.
- Enforce the case lifecycle already represented in code: OPEN → TRIAGED → IN_PROGRESS → RESOLVED → CLOSED. Require a resolution summary before resolution; do not permit reopening through an undocumented status patch.
- Validate assignees as active, verified staff with the required operational role/capability.
- Add concurrency protection so simultaneous updates cannot overwrite each other or emit duplicate transitions/audit events.
- Provide controlled shipment interventions as explicit domain actions (for example, request reassignment, record an approved exception, or coordinate cancellation), each with its own eligibility checks and audit reason.
- Never expose a generic endpoint that lets staff set arbitrary booking, payment, assignment, custody or delivery-leg status.
- Ensure operations reads expose only the customer/recipient/driver data needed for the task.

**Acceptance criteria:**
- Every supported exception has a deterministic case creation/linking path.
- Case transitions and assignment changes are atomic, validated and audited.
- An invalid lifecycle transition is rejected with a stable conflict response.
- Staff cannot use case-management permissions to mutate shipment or financial state outside explicitly authorized domain actions.
- Queue pagination/filtering and object-level access are covered by tests.

### 3E — Customer support and cancellation coordination

**Purpose:** support customer enquiries and cancellation/dispute handling without conflating support workflow with shipment or refund state.

Work:
- Audit ticket creation, customer-owned listing, admin/support queue and ticket updates.
- Define ticket statuses, allowed transitions, priority, category, assignment, escalation and closure/reopen policy.
- Validate ticket assignees as active ADMIN/SUPPORT users; reject arbitrary or inactive user IDs.
- Separate customer-visible replies from internal notes. Enforce visibility at the API boundary and prevent internal notes from leaking through customer ticket reads or notifications.
- Add a customer-visible response history and durable timestamps/actor attribution if not already present.
- Link tickets to parcel/ride bookings and operational cases without duplicating authoritative booking state.
- Define cancellation outcomes by booking, payment and fulfilment state. Unpaid cancellation may release eligible reservations; paid or in-progress cancellation must enter policy review/support coordination. Never infer refund approval or issue a refund automatically from ticket closure.
- Add escalation paths for damage, loss, failed custody, recipient unavailability, safety and payment/refund disputes.

**Acceptance criteria:**
- Customers can access only their own tickets and customer-visible messages.
- ADMIN/SUPPORT can access the queue according to explicit permissions and assignment policy.
- Only eligible staff can be assigned.
- Internal notes are never returned to customer-facing endpoints.
- Cancellation requests follow a documented state matrix and do not silently mutate payment/refund records.
- Ticket and cancellation actions are audited and tested.

### 3F — Contract, integration and release hardening

**Purpose:** ensure the operations API is safe to consume from the frontend and safe to deploy.

Work:
- Reconcile README, API contracts, frontend readiness, OpenAPI implementation metadata and actual mounted Express routes.
- Correct stale documentation that refers to old feature branches or retired authentication/payment behavior.
- Resolve the refresh-token contract conflict: `docs/api-contracts.md` currently describes HttpOnly cookie behavior, while `docs/frontend-contract-readiness.md` currently says tokens are returned in JSON. Source code and tests must decide the canonical behavior; then update all documentation and OpenAPI consistently.
- Verify all Phase Three routes have strict request schemas, consistent response/error envelopes, pagination limits and stable operation IDs.
- Add integration coverage for permissions, ownership, state transitions, idempotency, audit emission, concurrent updates and privacy boundaries.
- Run `npm test`, `npm run api:validate` and `npm run db:validate` (plus the repository's full CI suite) on each implementation slice.
- Verify deployment environment configuration separately; repository code does not prove production CORS, email or maps credentials are correct.
- Keep payment initialization disabled and partner external transfers out of scope.

**Acceptance criteria:**
- Mounted routes and OpenAPI are in parity.
- No stale or contradictory contract remains for the workflows delivered in this phase.
- All required tests and CI checks pass.
- No production migration or live financial action occurs without explicit approval.

### Delivery order and pull-request boundaries

Implement in this order; later slices depend on the security and lifecycle guarantees established earlier:

1. **3A.1 — Route/permission inventory and authorization matrix** (documentation + tests; no broad permission refactor before the inventory is reviewed).
2. **3A.2 — Audit coverage and safe admin mutation primitives.**
3. **3B — Geography/service-zone safety and audit gaps.**
4. **3C — Partner/hub lifecycle and membership administration gaps.**
5. **3D — Operational case completeness and controlled interventions.**
6. **3E — Support workflow and cancellation policy gaps.**
7. **3F — OpenAPI parity, documentation reconciliation and full regression hardening.**

Each slice must be independently reviewable, include tests and update the API contract. Do not combine unrelated schema redesigns with endpoint work. Create migrations only when the source audit proves they are necessary.

### Phase Three completion gate

Phase Three is complete only when all 3A–3F acceptance criteria are met, the permission matrix matches the mounted routes, all privileged mutations are auditable, operational cases and support workflows are lifecycle-safe, OpenAPI matches runtime behavior, and full CI passes. Existing endpoint presence or a passing frontend-readiness document alone is not sufficient evidence of completion.

### Known documentation reconciliation items

- `docs/api-contracts.md` and `docs/frontend-contract-readiness.md` disagree about refresh-token storage/transport. Verify implementation and tests, then choose one canonical contract.
- `docs/operational-workflows.md` still describes endpoints as belonging to `feat/secure-lifecycle-payments` and says they are not deployed by that branch. Update its status and route descriptions to match the current default branch.
- The README's older Priority 5 progress paragraph describes multi-leg routing and hub/partner custody as incomplete, while later Priority 6 progress and current source modules describe these capabilities as implemented. Reconcile the progress narrative against current code and tests before using it as a release checklist.

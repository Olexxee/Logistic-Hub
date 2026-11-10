# Logistic Hub

## Geography and serviceability

- [GEO-01 Service-Zone Operations Audit](docs/geo-01-service-zone-operations-audit.md) — verified geography/service-zone foundation and GEO roadmap.
- [GEO-03 Coordinate-to-Service-Zone Resolution](docs/geo-03-coordinate-service-zone-resolution.md) — server-authoritative point-in-polygon rules and fail-closed booking resolution.
- [GEO-04 Service-Zone Readiness Audit](docs/geo-04-service-zone-readiness-audit.md) — Admin preflight for zone boundaries, availability, pricing, configured driver coverage and active overlaps.
- [GEO-04 Staging Acceptance Record](docs/geo-04-staging-acceptance.md) — deployment evidence, environment blockers, and the controlled read-only data acceptance checklist.

## Identity and workspace authorization

- [Workspace Authorization Contract (WSP-02)](docs/workspace-authorization-contract-wsp-02.md) — defines primary workspace roles, independent partner/hub memberships, Partner-owner hub access, driver application lifecycle, explicit role provisioning and backend authorization requirements. WSP-03A Driver/Partner enforcement and WSP-03B canonical workspace resolution are implemented in the backend; full route-scope audit, Admin provisioning and frontend workspace migration remain separate phases.

## Generic business integrations

- [Generic Logistics Integration API](docs/integrations/generic-logistics-integration-v1.md) — reusable multi-client boundary for commerce, importation and fulfilment platforms. GIL-01–GIL-05D are merged. LI-02G-A private packing evidence, LI-02G-B four-photo buyer review/dispatch authorization and LI-02G-C1A end-to-end partner-to-recipient delivery closure are merged. LI-02G-C2 adds authenticated, idempotent stop and return-request commands; implementation is under review in Logistic Hub PR #117. A return request is not physical return completion. See the [generic integration contract](docs/integrations/generic-logistics-integration-v1.md), [MarketIQ contract v2](docs/integrations/marketIQ-v2.md), [C1A delivery closure](docs/integrations/li-02g-c1a-end-to-end-delivery-closure.md) and [C2 stop/return contract](docs/integrations/li-02g-c2-stop-return-commands.md). Billing/reconciliation remain future work.
- [MarketIQ integration contract v2](docs/integrations/marketIQ-v2.md) — MarketIQ-authoritative payment authorization, separate buyer/seller identities, minimal shipment data, four packing photographs, four-hour buyer review, dispatch authorization, and custody-aware stop/return coordination. This specializes but does not fork the generic API.

Logistic Hub is a Nigeria-focused logistics platform for coordinating local parcel delivery and inter-state shipments through verified workers, transport partners and operational hubs.

The platform coordinates the shipment lifecycle: booking, route and capacity checks, quotation, customer acceptance, payment verification, dispatch, custody transfers, delivery confirmation and financial reconciliation. It is designed to expand across Nigerian states through configurable geography, partner agreements and service coverage rather than one-off code changes.

## Administration implementation

- [Admin & Hub Management backend contract audit](docs/admin-hub-management-audit.md) — AH-0 source audit, API contracts, role taxonomy, authorization boundaries and implementation blockers.
- [AH-5 Partner & Geography contract audit](docs/ah-5-contract-audit.md) — AH-5.0 source-verified partner, membership, agreement, rate-card, geography, service-zone and hub integration readiness.
- [Nigeria geography reference data](docs/nigeria-geography-reference-data.md) — source attribution, 37 state-level units, 774 LGAs/Area Councils and the safe dry-run/apply seed workflow.
- [GEO-06 Staging Admin bootstrap](docs/staging-admin-bootstrap.md) — guarded, one-time staging-only Admin provisioning with email verification and audit evidence.

### Admin & Hub Management progress

- **AH-0:** backend contract and authorization audit completed; subsequent implementation deltas are recorded in the audit document.
- **AH-1:** admin user and account controls implemented in the merged backend work.
- **AH-2:** hub applications and approval flow are implemented. Partner OWNERs can submit applications; ADMIN review creates a PENDING hub and manager membership. Hub activation remains a separate operation.
- **AH-3:** hub manager/staff membership management implemented; hub-scoped managers can add operators, while manager assignment and privileged membership controls remain ADMIN-governed.
- **AH-4:** explicit ADMIN-granted hub dispatch delegation implemented through the canDispatch capability; dispatch matching remains scoped to the exact active hub membership.
- **AH-5:** AH-5.0–AH-5.6 backend work is merged. This includes partner administration, memberships, agreements/rate cards, Nigeria-restricted Google Maps integration, service-zone/geography contracts and partner/hub lifecycle synchronization. Frontend AH-5.5 service-zone administration is merged in `Olexxee/logistic-frontend` PR #32. The geography schema and ADMIN CRUD routes exist. A source-attributed Nigeria dataset and safe, dry-run-by-default seed runner are implemented; execution against the hosted/production database is **not verified** and must not be assumed. See [Nigeria Geography Reference Data](docs/nigeria-geography-reference-data.md). The future first-party location-intelligence initiative is separate from AH-5.4.

**AH-5 implementation gate:** frontend commercial screens must consume the implemented AH-5.3 endpoints and preserve rate-card version immutability. Agreement activation/status and rate-card publication require a reason. AH-5.6 enforces partner/hub lifecycle consistency: partner suspension or closure suspends active partner-owned hubs in the same transaction with audit records; hub activation requires an ACTIVE, VERIFIED owner. Reactivating a partner does not automatically reactivate its hubs; each hub requires an explicit, separately validated activation decision. **Geography readiness remains a separate data task:** verify/import the Nigeria country, 37 state-level units and 774 LGAs before claiming complete reference coverage; this must not imply service availability.

## Driver & Vehicle Operations

- [Driver & Vehicle Operations README](docs/driver-vehicle-operations-readme.md) — source-of-truth DRV-00–DRV-07 roadmap. The unified Admin driver/vehicle workspace and capability/suitability model are implemented; DRV-05C backend safety holds, driver recovery, hub recovery and hub disposition (D1–D2) are merged. Route-specific pricing/activation (D2B), frontend recovery/disposition workflows and staging acceptance remain outstanding.

## Driver assignment lifecycle

DRV-03 availability/location hardening, DRV-04A assignment lifecycle hardening, DRV-04B PostgreSQL reservation-concurrency coverage and DRV-04C unpaid-reservation expiry/release are merged. PR #96 merged on November 5, 2026 (merge commit `cc20e50aee924218095d1f6d70bcfff560adcbdf`); its README statement that it was awaiting merge was stale. See [Current Implementation Stopping Point](docs/current-implementation-status.md) for the exact completed/remaining work and [Driver Assignment Lifecycle Policy](docs/driver-assignment-lifecycle-policy.md) for lifecycle invariants.

## Driver verification and staged KYC

The driver verification workflow now supports private evidence uploads, Admin document review, audited reapplication and explicit test-versus-strict KYC tiers. Local/staging testing can use `DRIVER_KYC_MODE=TEST` to approve `TEST_LIMITED` drivers without full identity evidence. Test-limited drivers are restricted to parcel delivery, cannot receive passenger-ride offers, and do not accrue payout records. Production requires `APP_STAGE=production` and `DRIVER_KYC_MODE=STRICT`; strict review requires an approved identity document and the applicable driver-license/vehicle-registration evidence. See [Driver Verification and Staged KYC Policy](docs/driver-kyc-policy.md).

Driver documents are stored privately through Cloudinary, signature-validated, access-controlled and audited. Rejected applications can be resubmitted under the mode-specific evidence rules. This is not a claim that all statutory KYC requirements have been implemented; the policy document records the initial strict-mode checklist and release gates.

## Runtime deployment model

The API, outbox email worker and unpaid-assignment expiry worker run in one Node process. Deploy one Render Web Service with `npm start`; separate worker services are not required. See [Current Implementation Stopping Point](docs/current-implementation-status.md).

## Product blueprint

- [Admin & Hub Management backend contract audit](docs/admin-hub-management-audit.md) — AH-0 source audit, current API contracts, role taxonomy, authorization boundaries and implementation blockers.

## Product blueprint


### Admin workspace implementation status

The platform Admin workspace is implemented in the frontend main branch through ADM-01 and ADM-03–ADM-07 (latest audit-log closeout: frontend PR #41). It is a platform-administration and operational-oversight workspace, not a customer account with elevated permissions.

- User directory, account suspension/reactivation and session revocation are implemented with audited backend controls.
- Hub applications, hub lifecycle, partner administration, memberships, agreements/rate cards and service-area administration are represented in the merged Admin work.
- Admin booking/quote/leg oversight and custody/hub-intake visibility are read-only operational views; Admin does not perform customer booking, driver dispatch, partner assignment or hub custody actions through customer/operator workflows.
- Admin finance and support controls include refund review/reconciliation and support management. Payment checkout remains disabled; external payouts are not available.
- Audit-log search, filters, pagination and read-only event detail/snapshots are implemented.
- Staging role/permission acceptance and deployment verification remain outstanding. The approved staging Nigeria geography seed has now been applied and independently verified; GEO-06 introduces the guarded first-Admin bootstrap path. Owner governance and a typed Admin settings editor remain deliberately deferred.

### Launch scope and operating principles

- **Initial launch area:** multiple Lagos Local Government Areas (LGAs) from day one.
- **Backend first:** stabilize API contracts, lifecycle rules and tests before expanding client applications.
- **Partner-led inter-state pricing:** negotiated transport-partner agreements are the primary source of rates for covered routes. Logistic Hub does not invent market prices or impose a universal price on independent drivers.
- **Customer price acceptance:** the sender must approve the complete quote before the shipment is committed at that price.
- **Capacity before collection:** for inter-state shipments, confirm a suitable transport option and an acceptable commercial quote before dispatching a local collection agent, unless the sender explicitly agrees to a different arrangement.
- **Payments remain disabled:** no live payment collection, payout activation or production payment configuration without explicit repository-owner approval.
- **Refunds are independently gated:** customer refund requests are recorded for ADMIN review; provider submission and refund webhooks remain disabled unless `REFUNDS_ENABLED=true` is explicitly approved and a Paystack secret key is configured. `PAYMENTS_ENABLED` remains disabled.
- **Controlled repository workflow:** do not merge changes into `main` without explicit approval.

### Refund and paid-cancellation controls

- Unpaid bookings may be cancelled immediately under the existing booking lifecycle rules.
- A paid cancellation moves the booking to `CANCELLATION_PENDING`, opens a high-priority support ticket and creates a `PENDING_REVIEW` refund request for the remaining captured balance. It does not call Paystack.
- ADMIN reviews refund requests. Rejection is audited and restores a cancellation-pending booking to its prior recorded status. Approval submits a provider refund only when `REFUNDS_ENABLED=true`.
- A cancellation is finalized only after Paystack confirms a full refund through a verified webhook or reconciliation. Partial refunds do not automatically cancel the booking.
- An uncertain provider submission is locked against resubmission. ADMIN reconciliation looks up the unique merchant-note token and fetches the provider refund record; it never creates a second refund.
- Refund amounts are integer minor units, idempotency keys are mandatory, refundable balances include pending/processing/processed refunds, and all review/provider transitions are audited.

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

Priority 5 delivery-leg implementation is complete and has been extended by the subsequent merged work. The backend supports direct local legs, quote-driven multi-leg inter-state plans, delivery-leg dispatch, assignment execution and owner-scoped shipment timelines. Partner assignment and hub custody handovers are implemented in the Priority 6 work below; operational exception handling is extended by Phase 3D/3E. See the merged delivery-leg, quote, partner and hub work (including PRs #24–#29, #33 and #35–#37).

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

This README combines the **target product blueprint** with the current implementation record. Core booking/authentication, quote versioning, variable delivery legs, driver execution, partner execution, hub custody, operational exceptions, support/cancellation workflows, internal settlement/reconciliation and the backend contracts supporting the Admin workspace have implementation coverage in merged work. The frontend Admin workspace (user/access management, hub/partner administration, operational oversight, finance/support controls and audit logs) is also merged in Olexxee/logistic-frontend through PR #41. This does not establish production readiness: route contracts, automated tests, deployment configuration and staging acceptance remain separate release gates.

The initial rollout targets **multiple Lagos LGAs**. The intended commercial sequence is **partner-rate/capacity selection → sender quote acceptance → payment → dispatch**, with authorized quotation fallback for uncovered routes. Maps default to disabled. Payment initialization is hard-disabled; refund processing has a separate disabled-by-default gate. Internal partner settlement records do not initiate external transfers.

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

**Status: Phase Three implementation is in final contract/release hardening (3F-C); see the progress table below.**  
**Baseline:** `main` after merged Phase Three PRs #45–#62 (1 November 2026).  
**Implementation rule:** audit and extend the existing modules. Do not recreate APIs or schema that already satisfy the requirements. Keep all work on reviewable feature branches; do not merge to `main` without repository-owner approval.

### Phase Three objective

Deliver a secure operations console API and reliable administrative workflows for managing users, service coverage, transport partners, hubs, shipment exceptions and customer support. Every privileged mutation must be authorized server-side, validated against the relevant domain lifecycle, attributable to an actor, and auditable.

This phase does not authorize live payment activation, external partner transfers, production database migrations, or arbitrary shipment-status overrides.

### Existing baseline confirmed in source

The following are present on the baseline branch. Their presence does **not** mean the complete Phase Three acceptance criteria are already met.

| Capability | Existing implementation | Initial assessment |
|---|---|---|
| Admin user directory | `GET /api/v1/admin/users`; search, role/status filters and pagination in the discovery module | Read-only directory. No verified user-role/permission administration workflow established by this endpoint. |
| Audit events | `GET /api/v1/admin/audit-events`; ADMIN-only router | Read-only audit listing and the Phase 3A mutation-audit foundation are implemented; see the audit coverage matrix. |
| Geography | Admin country/state/LGA routes under `/api/v1/geography/admin` | Phase 3B lifecycle guards and serializable parent-geography mutations are implemented; see PRs #50–#51. |
| Service zones | Admin service-zone CRUD and per-service availability operations | Phase 3B prevents unsafe deactivation or availability changes while active hubs depend on coverage; writes are transactionally guarded. |
| Hubs | Hub administration service supports create/update, operator verification review and status changes | Phase 3B/3C lifecycle and membership invariants are implemented, including safe closure/suspension constraints; see PRs #50–#52. |
| Operational cases | Admin list/update endpoints with status transitions, priority, assignee and resolution | Phase 3D adds the operations overview, filtered cursor queue, serialized updates and exception deduplication; support escalation is linked in 3E. |
| Support tickets | Customer create/list and ADMIN/SUPPORT queue/update endpoints | Phase 3E implements validated assignment/lifecycle rules, public replies/internal notes, private evidence, operational-case escalation and audit coverage. |
| Cancellations | Customer-owned cancellation request endpoint and customer cancellation history | Phase 3E implements unpaid cancellation, paid cancellation review, refund request/review/reconciliation and owner-scoped cancellation history; provider refunds remain disabled by default. |
| Partner administration | Partner pricing and execution modules, agreements, rate cards, quotes and memberships | Phase 3C lifecycle/membership invariants and transactional commercial mutation safeguards are implemented; see PR #52. |

### Phase Three implementation progress

| Slice | Status | Evidence |
|---|---|---|
| 3A.1 — Route and permission inventory | Merged; implemented | [Administrative route and permission inventory](docs/admin-route-permission-inventory.md); `test/admin-route-permission-inventory.test.js` |
| 3A.2–3A.5 — Audit coverage, authorization regression, system actors and governance | Merged; implemented | PRs #46–#49; [audit coverage matrix](docs/admin-audit-coverage.md). Human and system audit actors, request correlation, mutation coverage and route-authorization regression tests are in place. |
| 3B — Geography and service-coverage lifecycle integrity | Merged; implemented | PRs #50–#51. Transactional lifecycle guards for service zones, availability and hubs; parent geography mutations use bounded serializable retries. |
| 3C — Partner/hub lifecycle and membership administration | Merged; implemented | PR #52. Partner activation/suspension/closure, agreement/rate-card concurrency and membership invariants hardened. |
| 3D — Operational case completeness and controlled interventions | Merged; implemented | PRs #53–#54. Admin operations overview, filtered/paginated case queue and concurrency-safe case updates. |
| 3E — Support workflow and cancellation coordination | Merged; implemented | PRs #55–#60. Ticket lifecycle, conversations, private evidence, cancellation history, case escalation and audited refund review. |
| 3F-A — API contract and pagination alignment | Merged; implemented | PR #61. Standardized support/hub pagination envelopes and fixed shared query validation. |
| 3F-B — Authentication and authorization hardening | Merged; implemented | PR #62. Session-bound access tokens, persisted-session checks on every authenticated request and database-authoritative roles. |
| 3F-C — Documentation and contract reconciliation | Merged; implemented | Backend PR #63 and frontend PR #29. Reconciled the HttpOnly refresh-cookie contract, mounted authentication routes, operational workflow guidance and frontend readiness documentation. |

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
- Keep the canonical refresh-token contract consistent across source, tests, API docs, frontend readiness and OpenAPI: the refresh token is an HttpOnly cookie, the short-lived access token is returned in JSON, and the retired JSON compatibility route returns HTTP 410.
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

### Documentation reconciliation

The canonical authentication contract is an HttpOnly refresh cookie plus a short-lived access token returned in JSON. The cookie is never returned in the response body; browser requests must include credentials and the trusted-origin CSRF header. The frontend-readiness and operational-workflow documents are reconciled to the mounted routes and current runtime behavior in this 3F-C slice.


## Google Maps provider configuration

The Maps API is disabled by default. To enable the server-side Google provider, set:

- `MAPS_PROVIDER=google`
- `GOOGLE_MAPS_API_KEY` to a server-side key stored only in the backend secret manager.

Enable Places API (New), Geocoding API and Routes API for the Google Cloud project. Restrict the key to these APIs and apply an appropriate server-side application restriction where the hosting environment supports it. Never expose this key in frontend environment variables or browser code. Maps endpoints require authentication and share a persistent limit of 60 requests per user per minute. The backend restricts autocomplete and geocoding to Nigeria; this does not mean a location is covered by an active Logistic Hub service zone.

When displaying Places predictions in the frontend, include the Google Maps attribution/logo required by the current Places API display policies; do not present Google-derived predictions as Logistic Hub's independently sourced directory. Customer pickup/drop-off and partner/hub address forms should use the same flow: debounce input and begin autocomplete after at least three characters → use one URL-safe UUID v4 session token for that search → resolve the selected place with the same token → discard the token → let the user confirm → submit the normalized address and coordinates to the existing booking or hub application contract. A selected address is not proof of serviceability; the backend's service-zone and operational checks remain authoritative.

## Future roadmap — first-party location intelligence

A future initiative may build Logistic Hub's own searchable geographic dataset from independently sourced, properly licensed and appropriately consented first-party location information. It is explicitly outside the current AH-5.4 implementation.

- Keep customer delivery addresses private; do not turn personal address records into a public/shared directory.
- Keep source provenance, consent, verification and confidence separate from operational serviceability.
- Google Places content must not be copied into or used to build/augment a separate mapping database. Retain Google Place IDs and other Google-derived data only as permitted by the applicable Google Maps Platform terms and policies.
- Any future first-party directory should use independently sourced or licensed geographic data (for example, OpenStreetMap data subject to its ODbL obligations), plus independently verified operational locations.
- A future migration must separately assess address search, map tiles, geocoding, routing and navigation; replacing autocomplete alone does not replace those capabilities.

## Private support evidence storage

Support-ticket evidence is stored in a private Firebase Storage bucket. The API authenticates to Google Cloud Storage server-to-server using a Base64-encoded Firebase service-account JSON document. The browser never receives service-account credentials or a public object URL.

Configure both backend environment variables:

- `FIREBASE_SERVICE_ACCOUNT_BASE64`: Base64-encoded service-account JSON.
- `FIREBASE_STORAGE_BUCKET`: the exact bucket name shown in Firebase Storage settings (for example, the project-specific `.firebasestorage.app` bucket name).

PowerShell example for encoding the downloaded service-account JSON locally:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\firebase-service-account.json"))
```

Copy the command output into the backend secret store as `FIREBASE_SERVICE_ACCOUNT_BASE64`. Do not commit the JSON file or encoded value. Grant the service account permission to create, read and delete objects in the evidence bucket. Keep the bucket private; access is mediated by authenticated API endpoints.

Evidence uploads use raw bytes with `Content-Type: application/octet-stream` and the `x-file-content-type` and `x-file-name` headers. Supported files are JPEG, PNG, WebP and PDF, up to 10 MB.

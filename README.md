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

The next Priority 6 implementation is being developed separately: hub-operator membership administration, authenticated custody handovers, receiver-only confirmation, expiry handling, evidence/condition capture, and automatic high-priority operational-case creation when a receiver rejects a handover. Recipient confirmation is deliberately deferred until a verified recipient identity or OTP delivery channel exists. Operational-case triage/resolution and partner settlement/reconciliation remain outstanding. Live payments and provider payouts remain disabled.

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

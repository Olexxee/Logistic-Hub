# Logistic Hub

Logistic Hub is a Nigeria-focused logistics marketplace coordinating local parcel delivery, inter-state transport, partner hubs, customer quotations and shipment custody. It connects customers with verified local delivery agents and transport partners while keeping pricing, assignment, payment and handover decisions auditable.

The initial rollout targets multiple Lagos LGAs. The platform is designed to expand to additional states and service types through configurable coverage, routes, partner agreements and capabilities rather than one-off code changes.

## Product and technical foundation

- [Technical foundation](docs/technical-foundation.md)
- [Foundation decisions: geography, maps and Paystack split payments](docs/foundation-decisions.md)
- [State machines and matching algorithm](docs/state-machines-and-matching.md)
- [Payment ledger and settlement](docs/payment-ledger.md)
- [Database integrity and migration strategy](docs/database-integrity.md)
- [OpenAPI contract baseline](docs/openapi.yaml)
- [Initial database schema](prisma/schema.prisma)
- [Supplemental PostgreSQL constraints](prisma/constraints/foundation.sql)
- [API contract overview](docs/api-contracts.md)

## Initial architecture

- **Backend:** JavaScript (ES modules), Node.js and Express.
- **Data layer:** PostgreSQL and Prisma ORM.
- **Geography:** Country/state/LGA/service-zone coverage, with multi-LGA Lagos launch support and cross-state routes.
- **Maps and routing:** provider-neutral server-side adapter; Google Maps geocoding and Routes API adapter is present but disabled by default.
- **Pricing:** partner-agreed rate cards are the primary source for covered inter-state routes. Controlled, authorized quotation is required where no agreement applies. The system selects and calculates quotes; it must not invent rates or impose unagreed market prices.
- **Payments:** Paystack is the intended provider, subject to merchant-account capability and terms validation. Payment collection and payouts remain disabled until explicitly approved.
- **Async processing:** Redis and a queue worker may be added for offer expiry, notifications and retries; PostgreSQL remains the source of truth.

## Logistics operating blueprint

This blueprint is the product and architecture reference for implementation. It describes the target operating model; it does not claim that every capability below is already implemented.

### 1. Core operating flow

1. A customer creates a parcel booking with sender/recipient details, origin, destination, parcel measurements and service requirements.
2. The system checks route coverage, parcel eligibility, partner terms and transport capacity.
3. The quotation engine selects a valid partner rate card when available and calculates the full customer quote, including applicable collection, hub handling, destination delivery and platform charges.
4. If no valid rate covers the route, operations must obtain an authorized provider quote. The system must not fabricate a price.
5. The customer accepts the exact quote version before the price is committed. Material changes require a revised quote and renewed acceptance.
6. Payment is requested only after acceptance. A verified payment—not a client-side success redirect—authorizes the configured paid workflow.
7. The system coordinates the required delivery legs, custody handovers, tracking and exceptions.
8. Delivery is confirmed by the recipient or an authorized, auditable process; financial reconciliation and settlement follow the applicable terms.

For inter-state shipments, transport availability and a valid commercial quote should normally be secured before dispatching a local collection agent. If a parcel has already reached a hub before the onward quote is accepted, the customer must be informed of any charges already incurred and approve the onward arrangement before transport is committed.

### 2. Local and inter-state delivery

- **Local delivery:** one qualified local agent may collect from the sender and deliver directly to the recipient. A hub is not mandatory merely because the journey is long or crosses an LGA boundary.
- **Inter-state delivery:** the normal coordinated path is local collection, an approved origin hub, partner transport, a destination hub where required, and destination-side local delivery where required.
- **Direct end-to-end transport:** a qualified provider may handle a full route when eligible, available and commercially suitable.
- **Handover:** transfer directly between authorized workers or through a designated hub according to the route plan. Each transfer requires receiving-party confirmation and an auditable custody record.

Routing must consider service coverage, route boundaries, partner availability, worker capabilities, parcel restrictions, vehicle suitability, capacity, service promise and cost—not a simplistic distance threshold.

### 3. Domain boundaries

Keep these concepts separate and linked by explicit identifiers:

- **Parcel booking:** customer request, shipment details, accepted quote, payment state and overall outcome.
- **Quote and rate agreement:** partner agreement, rate-card version, route, parcel/service bands, calculation inputs, expiry, adjustments and customer acceptance.
- **Delivery leg:** one independently tracked segment, such as local collection, inter-state transport, hub transfer or final-mile delivery.
- **Worker assignment:** the responsible worker/provider, eligibility checks, acceptance and assignment history for a leg.
- **Custody event:** who released and received the parcel, timestamp, location, condition, evidence and confirmation.
- **Financial records:** customer payment, transaction verification, provider compensation, fees, refunds, payouts and reconciliation.

Do not use a single booking status to represent the status of every leg, hub intake, handover, delivery and settlement.

### 4. Roles, capabilities and authorization

Platform roles and worker capabilities are separate. A worker may hold several verified capabilities but receives only the permissions appropriate to a specific assignment. Registration must never allow users to grant themselves privileged roles or verification.

| Role | Primary responsibility |
| --- | --- |
| Customer/sender | Create bookings, accept quotes, pay, track shipments and raise disputes. |
| Local pickup/delivery agent | Collect or deliver within approved service areas. |
| Transport driver | Perform assigned transport legs and confirm handovers. |
| Hub operator | Receive, inspect, record custody and perform authorized hub/dispatch actions. |
| Operations | Manage routes, capacity, dispatch, exceptions and commercial rules. |
| Support | Handle customer enquiries and disputes within assigned permissions. |
| Administrator | Manage approvals, access, configuration, suspension and audit oversight. |

### 5. Hub ownership and control

All hubs use one system with an ownership type:

- **Company-operated:** staffed and controlled directly by Logistic Hub.
- **Partner-business-operated:** business and authorized staff are verified under agreed operational and commercial terms.
- **Individual-operated pilot:** identity and location checks, training, operator agreement, explicit approval, restricted permissions and initial volume/value limits.

KYC does not automatically authorize operational access. Individual pilot hubs should initially be limited to approved intake and custody recording. Dispatch rights may be delegated after review. Central operations retains control of hub approval, delegated permissions, exceptional fare changes, escalations, suspension and audit oversight. Trusted operators must not bypass accepted customer prices, assign unqualified workers or confirm custody on behalf of a receiver.

A hub can provide dispatch coordination without necessarily being a warehouse. The initial model may combine a small number of controlled physical receiving points with digital dispatch coordination.

### 6. Partner pricing and commercial records

Partner-agreed rates are the primary pricing source for contracted inter-state routes. Agreements should define applicable corridors, parcel and service categories, effective dates, capacity commitments, volume assumptions, service expectations, custody/claims responsibilities, review terms and compensation.

The quotation engine selects a valid rate and calculates the total; it does not set arbitrary market prices. Store the agreement ID, rate-card version, measurements, calculation inputs, adjustments and acceptance timestamp with the quote. Later rate-card changes must not alter an accepted quote.

Keep separate:
- **Customer charge:** the accepted total paid by the sender.
- **Provider compensation:** what the transport partner, driver or local agent is owed under their own applicable terms.
- **Platform revenue:** approved platform fees, commissions or other explicitly disclosed charges.

Distinguish drivers working under a transport company agreement from independently contracted drivers and providers requiring a separately authorized quote. Central operations controls active rates, parcel bands, charges, effective dates, discounts, surcharges and exceptions. Hub staff may record parcel measurements but must not invent prices; corrections must retain the previous value, new value, reason and operator.

### 7. Custody, tracking and exceptions

Each custody transfer records the booking/leg, releasing and receiving parties, timestamp, location, parcel condition, supporting evidence and receiving-party confirmation. PIN/QR confirmation must be validated by the backend, bound to the intended handover and protected against reuse. A sender, driver or hub operator cannot fabricate the receiver's confirmation.

Represent states such as in transit, arrived at hub, awaiting handover, delivery disputed and delivered distinctly. Failed handovers, recipient unavailability, damage, loss and conflicting evidence must create an operations exception path with an auditable resolution.

### 8. Geography and service coverage

Support Country → State → LGA → service zone, with coverage defined for hubs, agents and partners. Routes can cross LGAs and state boundaries. Check each delivery leg against service coverage, worker capabilities, route eligibility, parcel restrictions, vehicle type, operating hours and capacity. Launch coverage must include multiple Lagos LGAs from day one.

### 9. Backend workstreams and implementation order

1. **Repository/schema audit:** verify what exists on active branches, inspect migrations and current API contracts, and identify conflicts before changing the schema.
2. **Identity and authorization:** complete authentication, session restoration, logout, password recovery and backend permission enforcement.
3. **Geography, workers, partners and hubs:** define coverage, verification, capabilities, agreements and operational permissions.
4. **Booking and quotation:** implement rate-card selection, capacity checks, quote expiry/versioning and customer acceptance.
5. **Delivery legs and custody:** support direct local delivery and hub-assisted inter-state journeys with explicit handovers and exceptions.
6. **Payment and settlement:** implement and test verification, ledger, allocation, refunds, payouts and reconciliation without activating live payments.
7. **Operations and client integration:** stabilize documented backend contracts and lifecycle tests before expanding customer, worker, hub and operations clients.

Backend layers should retain the established separation of repository/database access, service business rules, controllers, routes and validation middleware. Database changes must use new timestamped migrations rather than editing an applied migration.

## Current status and guardrails

Backend foundation work is tracked on `feat/backend-foundation` and reviewed in [draft PR #3](https://github.com/Olexxee/Logistic-Hub/pull/3). The parcel booking list API is proposed in [PR #8](https://github.com/Olexxee/Logistic-Hub/pull/8); it adds pagination and lifecycle-status filtering with customer ownership restrictions and administrative access.

The initial migration is committed at `prisma/migrations/20261026121500_initial_foundation/migration.sql`. CI applies the committed migration chain to an empty PostgreSQL 16 database with `prisma migrate deploy`, checks migration history and schema drift, and runs PostgreSQL integrity tests. Future database changes must use new timestamped migrations.

The initial rollout targets **multiple Lagos LGAs**. The commercial flow is **route/capacity check → partner rate or authorized quote → sender acceptance → payment → dispatch**. Client applications should wait until API contracts and lifecycle tests are stable. Maps default to disabled. Payments are hard-disabled and must not be enabled through configuration without explicit approval.

Do not merge changes into `main`, apply production migrations, or activate live bookings/payments until implementation, tests, security review and relevant regulatory checks are complete and the repository owner approves the next step.

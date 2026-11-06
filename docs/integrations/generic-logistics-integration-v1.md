# Generic Logistics Integration API

**Status:** GIL-01–GIL-03 are implemented. GIL-04 booking bridge is under architecture/implementation; see [GIL-04 Booking Bridge](gil-04-booking-bridge.md) for the audited constraints and release gates. Tracking/webhooks and billing/reconciliation remain future work.

## 1. Objective

Logistic Hub exposes one logistics capability to independently operated commerce, importation, fulfilment and other business systems. Each external system is an integration client. Examples include MarketIQ and a future importation website; neither gets a client-specific route or pricing implementation.

The integration API is an adapter boundary around Logistic Hub's existing logistics domain. It does not duplicate the partner pricing engine, service-zone coverage, hub selection, route planning, dispatch, custody or exception handling.

## 2. Ownership

| Concern | Authority |
|---|---|
| Customer, seller, products, cart, order and customer payment | Integrating platform |
| External client identity, credentials and permissions | Logistic Hub |
| Package assessment and accepted measurement snapshot | Logistic Hub |
| Service coverage, route feasibility, legs and hub selection | Logistic Hub |
| Partner rate-card matching and logistics cost | Logistic Hub |
| Customer-facing delivery offers and quote expiry | Logistic Hub |
| Shipment booking, assignment, custody, delivery and exceptions | Logistic Hub |
| External order/customer/product references | Integrating platform; mapped by Logistic Hub |
| Billing agreement and logistics payable terms | Logistic Hub + integration client |

Integrators submit shipment intent and shipment facts they can reliably know. They cannot choose internal partners, drivers, hubs, route plans, rate cards, fare components or operational status.

## 3. Generic client registry

Each client has:
- unique immutable code (e.g. MARKETIQ, IMPORTATION_PORTAL);
- independent active/suspended/revoked state;
- explicit scopes;
- one or more revocable credentials, each identified by a public keyId and stored only as a one-way secret hash;
- one or more versioned billing agreements;
- a separate namespace for external references;
- idempotency records scoped by client, operation and key.

Credential secrets must be generated with cryptographic randomness, shown once at creation, stored as a one-way hash, and never logged. Rotation creates a new credential before revoking the old one. Suspended/revoked clients must be denied even if a credential remains active.

The registry is managed through ADMIN-only endpoints under `/api/v1/admin/integrations`. Client creation, status changes, credential issuance/revocation and draft billing-agreement creation are implemented. Every mutation requires a reason and writes an operational audit event in the same database transaction.

## 4. Generic API contract

Base path: /api/v1/integrations.

Authenticated client identity comes from a service credential, never from a caller-supplied sourceSystem or customer JWT. The authenticated client ID scopes every query and mutation.

Proposed operations:
- POST /marketplace/quotes — create a quote session and return all currently feasible delivery options.
- GET /marketplace/quotes/:quoteReference — retrieve options and expiry.
- POST /marketplace/quotes/:quoteReference/accept — accept exactly one option.
- POST /marketplace/shipments — create/recover a shipment using the accepted option and an idempotency key.
- GET /marketplace/shipments/:shipmentReference — read shipment state.
- GET /marketplace/shipments/by-external-reference/:externalReference — recover a booking after a lost response.
- Webhook subscriptions and signed event delivery are a later slice.

The word marketplace in this proposed path is a compatibility label only; the data model and authorization are not marketplace-specific. A later version may expose a neutral /shipments/quotes path without changing the domain.

Every external reference is scoped to the authenticated integration client. The same external order ID can exist in MarketIQ and an importation platform without collision.

## 5. Quote options and route pricing

A quote request returns zero or more complete delivery options, not one arbitrarily chosen route. Each option contains:
- opaque quote-option reference and version;
- service level label and estimated transit window where supported;
- route mode and high-level route summary;
- number and types of delivery legs;
- customer charge and logistics cost as separate NGN minor-unit strings;
- currency, billing agreement reference/version and expiry;
- parcel assessment snapshot and any assumptions requiring confirmation.

A route option is offered only when all required legs have eligible coverage and a valid commercial pricing source. Logistic Hub may return direct local, hub-assisted local, or multi-leg interstate alternatives where the operational and rate-card data supports them. It must not synthesize a price when a leg has no contracted/approved rate.

The buyer sees whole-shipment options and totals. Per-leg detail is retained for audit and operations; it is not necessary to expose partner cost or internal margin to the buyer.

## 6. Package assessment

Current internal parcel booking requires a supplied parcelSize. The codebase has partner-rate weight and dimension eligibility fields, but the generic integration must not pretend that a measurement/estimation service already exists.

The quote flow must support an explicit assessment state:
- DECLARED: integrating platform supplied measurements and their source;
- ESTIMATED: Logistic Hub derived a provisional package class/weight from supported catalog/category rules;
- MEASURED: Logistic Hub or an authorized hub/worker physically measured the parcel;
- REQUIRES_MEASUREMENT: no defensible quote can be issued until inspection.

Every measurement includes units, source, timestamp and confidence/verification state. Quotes based on estimates must say so and define the adjustment/acceptance policy. A measured parcel that materially differs from the accepted estimate must not silently increase the buyer's charge; it must trigger an explicit re-quote/approval or a documented platform subsidy rule.

GIL-03 implements a consignment-level quote session containing 1–50 package records. Each package is assessed independently against rate-card weight/dimension eligibility, but all packages in one option must be covered by a single partner rate card. This is the first packing model; palletization, volumetric-weight rules, consolidation and multi-carrier package splitting remain future extensions.

## 7. Billing boundary

Billing is configured per versioned agreement, not hard-coded by client:
- PLATFORM_COLLECTED: integrator collects from its customer and owes Logistic Hub the agreed logistics cost;
- LOGISTIC_HUB_COLLECTED: Logistic Hub collects from the customer (currently gated; this does not enable payment processing);
- PREPAID_ACCOUNT: charges consume an agreed prepaid balance (wallet/ledger implementation is separate);
- INVOICE: charges accrue for an agreed invoicing/reconciliation cycle.

The registry stores commercial terms only. It does not activate Paystack, customer collection, wallet debits, settlement or payouts. Each agreement has a version and effective dates; historical quotes/bookings retain their accepted snapshot.

## 8. Current implementation gaps and sequencing

The existing ParcelBooking is sender-user based and requires parcelSize; the internal quote route creates one ShipmentQuote per booking and its route planner creates the execution plan after quote acceptance. It is not yet a generic external quote-session API, and it cannot safely serve multiple external clients by merely adding a sourceSystem field.

Implementation sequence:
1. GIL-01 — Client registry foundation: client, credentials, billing agreements, idempotency and external-reference persistence. (Implemented in PR #97.)
2. GIL-02 — Service authentication and admin controls: ADMIN-only client administration, credential issue/revocation, one-time secret display, hash-only persistence, scope middleware and audited billing-agreement drafts. (Implemented in PR #97.)
3. GIL-03 — Package assessment and quote sessions: multi-package requests, multiple contracted options, expiry and option selection. (Implemented in this branch.)
4. GIL-04 — Generic shipment creation: bridge selected options into existing execution lifecycle without synthetic customer users or bypassing custody/dispatch rules.
5. GIL-05 — Tracking and signed webhooks: durable event delivery, deduplication, sequence ordering and replay controls.
6. GIL-06 — Billing/reconciliation: enforce agreement model only after payment/wallet/invoice capabilities are explicitly implemented and approved.

## GIL-03 quote-session API

The integration quote endpoints are mounted at `/api/v1/integrations` and use the service credential headers plus client scopes:
- `POST /quotes` — requires `quotes:write` and an `Idempotency-Key`.
- `GET /quotes/:quoteSessionId` — requires `quotes:read`; client ownership is enforced from authenticated credential context.
- `POST /quotes/:quoteSessionId/options/:optionId/accept` — requires `quotes:write` and a fresh `Idempotency-Key`.

Quote creation requires an active, effective billing agreement reference owned by the authenticated client. Client-supplied client IDs, agreement IDs, rates, prices, partners, route plans and statuses are not accepted.

### Package assessment and quote rules

- One quote session is a consignment with 1–50 package items. Each item has its own external package reference, category, declared weight and optional dimensions/value.
- Package measurements submitted by an integration are recorded as `DECLARED`, source `INTEGRATOR_DECLARED`. Logistic Hub does not treat client-declared measurements as physically verified.
- If any package weight is missing, the session is `REQUIRES_MEASUREMENT`; no quote is generated. No category-based estimation catalog exists yet, so no automatic estimates are fabricated.
- A package rate must match category, declared weight and every dimension limit configured on the rate. Missing a dimension required by a rate makes that rate ineligible.
- Quote options are grouped by one active, verified partner rate card and require exactly one matching rate per package. Overlapping rate definitions are treated as ambiguous and excluded rather than choosing arbitrarily.
- The logistics amount is the sum of contracted partner rates across packages. The platform charge is the active parcel PricingRule fixed connection fee, applied once per consignment. Customer charge is logistics + platform charge + other charges (currently zero).
- Only options with complete contracted coverage are returned. No fallback or invented rate is used. Up to 10 lowest-charge eligible options are returned.
- Same-state zones are labeled `LOCAL_DIRECT`; cross-state zones are labeled `INTERSTATE_CONTRACTED`. This is a quote-level pricing route label, not a promise of the actual operational hub/leg plan. Logistic Hub determines execution legs after shipment creation.
- Option acceptance selects one option and expires/rejects the alternatives. It does not create a booking or trigger payment; GIL-04 handles that bridge.

## 9. GIL-02 administration and authentication contract

Admin routes (ADMIN role only):
- `GET /api/v1/admin/integrations` — bounded client listing/search.
- `POST /api/v1/admin/integrations` — register a client and its initial scopes.
- `PATCH /api/v1/admin/integrations/:clientId/status` — activate, suspend or permanently revoke a client. REVOKED is terminal.
- `POST /api/v1/admin/integrations/:clientId/credentials` — issue a credential; the secret is returned once and never stored or audited in raw form.
- `POST /api/v1/admin/integrations/credentials/:credentialId/revoke` — revoke a credential; repeated revocation is safe.
- `POST /api/v1/admin/integrations/:clientId/billing-agreements` — create the next version as DRAFT. Agreement creation does not activate payment collection or settlement.

Integration requests authenticate using `X-Integration-Key-Id` and `X-Integration-Secret`. The server resolves the client from the key ID, verifies the one-way SHA-256 secret hash with a timing-safe comparison, and rejects missing, invalid, expired, revoked or suspended credentials/clients. `requireIntegrationScope(...)` enforces all requested scopes against the authenticated client's registry scopes. GIL-03 mounts the quote routes at `/api/v1/integrations/quotes`. Billing-agreement status changes are available to ADMIN at `PATCH /api/v1/admin/integrations/:clientId/billing-agreements/:agreementId/status`; only one version per agreement reference can be ACTIVE.

Admin mutations require a reason and write audit events atomically with the corresponding database mutation. Audit metadata contains credential key IDs and labels only, never the secret or secret hash. Credential `lastUsedAt` is best-effort telemetry and does not block an authenticated request.

## 10. Security invariants

- Never trust client-supplied client identity, billing model, rate, route, legs, quote total or shipment status.
- Use service credentials scoped to client and operation; no customer JWT reuse.
- Store only credential hashes; show raw secret once.
- Scope idempotency and external-reference uniqueness to the authenticated client.
- Persist canonical request hashes; same key/different payload is a conflict.
- Enforce quote expiry and exact shipment-snapshot binding at acceptance and booking.
- Keep customer charge, provider cost and any platform subsidy distinct.
- No direct customer charging, wallet debit, payout or settlement is activated by this foundation.

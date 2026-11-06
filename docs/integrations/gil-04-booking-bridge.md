# GIL-04 — Integration Booking Bridge

**Status:** GIL-04A is implemented and merged in PR #100. GIL-04B ownership/package schema and migration are implemented on the integration branch; PostgreSQL integrity tests are added. The integration shipment factory and endpoint remain unimplemented.

## Objective

Create a Logistic Hub parcel booking from a selected GIL-03 quote option for an authenticated integration client. The bridge must reuse the existing parcel-booking, accepted-shipment-quote, delivery-plan, partner-execution and custody domains. It must not create synthetic customer users, recalculate the accepted quote, initiate a second customer charge, or let the integration choose internal execution resources.

## Source-of-truth boundaries

| Concern | Authority |
|---|---|
| Buyer, seller, order, seller order, fulfilment and customer payment | Integrating platform |
| Quote, package assessment, coverage and contracted logistics price | Logistic Hub |
| Booking, operational route plan, delivery legs, partner/driver assignment, custody and exceptions | Logistic Hub |
| External payment verification and customer refund | Integrating platform under PLATFORM_COLLECTED |
| Logistics payable and partner execution cost | Logistic Hub billing agreement and accepted quote snapshot |

The integration client is trusted to attest that it verified the external customer payment because that platform owns the payment transaction. Logistic Hub records the attestation for audit; it does not treat the external reference as a Logistic Hub Paystack transaction.

## Repository audit: blockers that must be resolved

### 1. Booking ownership

`ParcelBooking.senderId` is currently required and references a Logistic Hub `User`. The internal booking service creates bookings for a sender user and the customer-facing dispatch/fare flows authorize against that sender.

**Required direction:** support an integration-owned booking identity explicitly. Do not create one fake Logistic Hub customer per external buyer or fulfilment. Keep user-owned bookings unchanged; integration-owned bookings must be attributable to an active `IntegrationClient` and accessible only through that client's authenticated integration boundary and authorized operational roles.

### 2. Multi-package consignments

GIL-03 accepts 1–50 package records and stores individual weights/dimensions/rate snapshots. `ParcelBooking`, however, has singular `parcelCategory` and `parcelSize` fields and no normalized package collection.

**Required direction:** preserve package-level facts on the booking in a first-class package model. Do not silently collapse a multi-package consignment into the first package's category or dimensions. Existing single-package customer booking behavior must remain compatible.

### 3. Quote-to-execution pricing parity

**GIL-04A implementation:** the integration quote engine and delivery-plan builder now share `resolveDeliveryRoute`. Quote options are emitted only for `END_TO_END` routes, where the contracted partner rate prices the single interstate leg and the platform fee is explicit. Same-state `LOCAL_DIRECT` and `HUB_ASSISTED` routes return `REQUIRES_OPERATIONAL_PRICING` with no selectable options until local-driver charges are fixed before collection. The selected end-to-end topology is persisted in the route snapshot and is pinned during later delivery-plan creation, so a newly activated hub cannot silently change a priced one-leg route into three legs.

GIL-03 currently prices package rates plus the platform connection fee. Its route mode is a quote-level pricing label. The existing execution planner may create:
- no delivery legs for a same-state `LOCAL_DIRECT` route;
- local pickup, interstate transport and final-mile legs when eligible hubs exist; or
- one end-to-end interstate transport leg when suitable hubs do not exist.

The local pickup/final-mile driver flows are sender-oriented and include separate fare proposal/acceptance behavior. The current integration quote does not price those local execution legs. A quote that omits required execution costs is not a complete customer-facing shipment price.

**Required direction:** before accepting shipment creation as production-ready, bind each quote option to a feasible operational route plan and all priced execution components. The selected quote must not create a booking whose required legs later introduce an unapproved second charge or a new fare negotiation after the external platform has collected payment. No route, hub or rate may be invented to fill a coverage gap.

### 4. Existing partner-execution prerequisites

The partner assignment service requires:
- a ready `INTERSTATE_TRANSPORT` delivery leg;
- `ParcelBooking.paymentStatus = SUCCEEDED`; and
- an accepted `ShipmentQuote` with a partner agreement.

The existing quote-acceptance route creates the accepted `ShipmentQuote` and route plan in one transaction, then moves the booking to `AWAITING_PAYMENT`. The integration bridge must produce equivalent durable records from the selected integration option, without invoking the internal customer payment flow.

### 5. Internal booking creation is not reusable unchanged

The existing `createDraft` service applies a separate platform pricing rule, requires a sender user, creates a `DRAFT` booking and leaves partner quotation/acceptance to a later internal flow. Calling it and patching the booking afterward would create an inconsistent intermediate state and could overwrite the integration quote's commercial snapshot.

**Required direction:** implement a dedicated integration booking service that creates the booking and all related records atomically from the selected quote option.

## Target API contract

Base path: `/api/v1/integrations`.

### Create shipment

`POST /shipments`

Required:
- `shipments:write` integration scope;
- `Idempotency-Key` header;
- selected, unexpired quote session and selected option owned by the authenticated integration client;
- a matching external fulfilment reference bound to the quote;
- external payment attestation for `PLATFORM_COLLECTED` agreements.

The server derives the client, billing agreement, package facts, pickup/destination snapshots, partner agreement/rate-card references, prices and selected option from persisted quote records. The request must not accept caller-supplied booking status, route, legs, hub, partner, driver, rate, customer charge or logistics cost.

The payment attestation must identify the external payment provider/reference, verification timestamp, currency and delivery-charge amount. The delivery-charge amount and currency must exactly match the selected quote option. The platform may also provide the overall order-payment amount for audit; that amount is not substituted for the delivery charge.

The service records the external payment attestation and marks the external collection as verified for the booking lifecycle. It must not create a Logistic Hub `PaymentAttempt`, call Paystack, initialize another customer payment, or create payment-ledger entries that imply Logistic Hub received the external customer funds.

### Read shipment

- `GET /shipments/:shipmentId` — read a shipment owned by the authenticated client.
- `GET /shipments/by-external-reference/:externalFulfillmentReference` — recover the shipment after a lost create response.

Responses expose Logistic Hub booking/tracking references, external fulfilment reference, current booking and leg milestones, accepted commercial snapshot and package summary. They must not expose internal partner costs or unrelated client data.

## Atomic creation invariants

The shipment creation transaction must:
1. replay an identical idempotent request or reject key reuse with a different canonical payload;
2. lock and validate the quote session and selected option for the authenticated client;
3. revalidate quote expiry and the applicable billing/partner agreement eligibility;
4. verify the payment attestation's delivery charge and currency against the selected option;
5. create an integration-owned `ParcelBooking` without a synthetic sender;
6. persist every package as a booking package record;
7. create an accepted `ShipmentQuote` preserving the selected option's immutable per-package rate and charge snapshots;
8. create the approved route plan and delivery legs using the same transaction;
9. persist the integration shipment/external fulfilment mapping;
10. persist the idempotent response before commit.

A failure at any step must roll back the booking, packages, quote, route plan, external mapping and idempotency response together.

## Implementation sequence and release gates

| Slice | Scope | Exit criteria |
|---|---|---|
| GIL-04A | Quote/execution parity | Shared route resolver; end-to-end routes are priced as one leg; local/hub-assisted routes fail closed with `REQUIRES_OPERATIONAL_PRICING` until local-driver charges are fixed |
| GIL-04B | Integration-owned booking and package persistence | Nullable sender is constrained to integration-owned records; user-owned booking behavior remains unchanged; packages are normalized |
| GIL-04C | Atomic shipment creation | Selected quote, external payment attestation, accepted ShipmentQuote, route plan, booking and idempotency commit atomically |
| GIL-04D | Shipment retrieval and recovery | Client-scoped ID and external-reference reads; no cross-client disclosure |
| GIL-04E | Regression and contract acceptance | PostgreSQL concurrency, replay/conflict, rollback, quote expiry, agreement suspension, package and lifecycle tests pass |

**Release gate:** do not expose shipment creation as generally available until GIL-04A and the booking/dispatch compatibility work are complete. GIL-04 does not enable Logistic Hub payment collection, refunds, wallet debits, payouts or settlement.

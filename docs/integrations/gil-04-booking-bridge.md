# GIL-04 — Integration Booking Bridge

**Status:** GIL-04A–GIL-04C are merged. GIL-04D client-scoped shipment retrieval and recovery is implemented in the current branch; the read boundary scopes both internal IDs and external fulfilment references to the authenticated integration client.

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

**GIL-04B implementation:** `ParcelBookingPackage` stores each package independently. Integration-owned bookings have `integrationClientId` and no `senderId`; the legacy single-package category/size columns are nullable and must remain null for integration-owned bookings. A database XOR ownership constraint prevents both owner types or ownerless bookings. Existing sender-owned booking records and their legacy fields remain intact.

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

The existing customer quote-acceptance path moves customer-owned bookings to `AWAITING_PAYMENT`. GIL-04C uses a separate `AWAITING_PARTNER_ASSIGNMENT` state because the integrating platform has already collected and verified the delivery charge before it calls shipment creation. The booking records `paymentStatus = SUCCEEDED` as an external-collection lifecycle fact, backed by `IntegrationPaymentAttestation`; it does not create a Logistic Hub `PaymentAttempt`, provider webhook event, Paystack charge, refund, or ledger entry.

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


## GIL-04C implementation contract

Endpoint: `POST /api/v1/integrations/shipments` with `shipments:write` and an `Idempotency-Key`.

The request contains only `quoteSessionId`, `quoteOptionId`, `externalFulfillmentReference` and a `paymentAttestation` (`paymentProvider`, `externalPaymentReference`, `verifiedAt`, `currency`, `deliveryChargeMinor`, optional `orderPaymentAmountMinor`). The fulfilment reference must exactly match the reference already bound to the quote session. The attested delivery charge and currency must exactly equal the selected option's customer charge and currency. The optional overall order amount is retained for audit only.

The transaction revalidates quote expiry/selection, the exact active PLATFORM_COLLECTED agreement version, active verified partner agreement/rate card, every package rate snapshot, current parcel-zone availability and total arithmetic. It creates no synthetic user and accepts no caller-supplied route, hub, partner, driver, rate, price, status or booking owner. The accepted partner agreement/rates and route snapshot are copied into the internal ShipmentQuote; package-rate detail remains in its immutable input snapshot. The operational route planner must return the pinned single END_TO_END interstate leg.

External collection is a trusted integration-client attestation, not independently verified by Logistic Hub. The booking is marked `paymentStatus = SUCCEEDED` only so the existing partner-execution gate can proceed; the attestation is the audit source. No Logistic Hub PaymentAttempt, Paystack call, provider webhook, payment-ledger entry, refund, wallet debit or settlement is created. The booking starts at `AWAITING_PARTNER_ASSIGNMENT`; the existing admin partner-assignment operation transitions an integration-owned booking to `DRIVER_ASSIGNED` atomically with the assignment record. When the assigned partner operator starts the leg, the same transaction advances the booking to `IN_TRANSIT`. Partner assignment views include normalized package facts.

The quote session transitions from `SELECTED` to `BOOKED` in the same transaction. An identical idempotency key/payload replays the stored response; key reuse with a different payload conflicts. Reuse of a payment reference or fulfilment reference for another shipment conflicts. A failure at any step rolls back all shipment records.

## Implementation sequence and release gates

| Slice | Scope | Exit criteria |
|---|---|---|
| GIL-04A | Quote/execution parity | Shared route resolver; end-to-end routes are priced as one leg; local/hub-assisted routes fail closed with `REQUIRES_OPERATIONAL_PRICING` until local-driver charges are fixed |
| GIL-04B | Integration-owned booking and package persistence | **Merged:** exclusive sender/integration ownership, nullable legacy single-package fields for integrations, normalized package model, package measurement/value constraints. |
| GIL-04C | Atomic shipment creation | **Implemented in this branch:** authenticated `shipments:write`; exact quote/fulfilment-reference binding; quote, billing agreement, partner agreement/rate card and package-rate revalidation; exact delivery-charge/currency attestation; integration-owned booking, packages, accepted ShipmentQuote, pinned one-leg plan, external reference, attestation and idempotent response commit atomically. |
| GIL-04D | Shipment retrieval and recovery | **Implemented in this branch:** client-scoped ID and external-reference reads; consistent not-found behavior for unknown and other-client references; response omits partner cost and package declared values. |
| GIL-04E | Regression and contract acceptance | PostgreSQL concurrency, replay/conflict, rollback, quote expiry, agreement suspension, package and lifecycle tests pass |

**Release gate:** do not expose shipment creation as generally available until GIL-04A and the booking/dispatch compatibility work are complete. GIL-04 does not enable Logistic Hub payment collection, refunds, wallet debits, payouts or settlement.

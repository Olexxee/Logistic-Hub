# MarketIQ Marketplace Integration — LI-01 Contract (v1.0 Draft)

**Status:** LI-01 audit and contract draft. No marketplace integration endpoint or schema is claimed to be implemented by this document.

## 1. Context and system boundary

MarketIQ is the commerce system of record for buyer/seller accounts, orders, seller orders, customer payment/refunds and marketplace fulfilment. Logistic Hub is the logistics system of record for provider quotes, bookings, delivery legs, routing, driver/partner assignment, hubs, custody, delivery exceptions and logistics operational resolution.

Services keep separate databases and deployments. MarketIQ IDs are external references, never Logistic Hub internal IDs. A marketplace integration client must not impersonate a Logistic Hub sender or use a customer JWT.

Commercial model:
- MarketIQ collects customer order payment, including the accepted delivery charge.
- MarketIQ is responsible for logistics cost reconciliation under a platform billing agreement.
- One shipment per MarketIQ seller order/fulfilment; multi-seller orders result in separate shipments.
- Initial settlement is manual.
- Logistic Hub must not initiate a second customer charge.

## 2. Existing Logistic Hub constraints to preserve

- Current parcel booking lifecycle is internal sender-based and includes quote acceptance/payment steps. It is not the external marketplace contract.
- Partner pricing and service-zone eligibility must remain authoritative and reused; no duplicated pricing algorithm or arbitrary universal rates.
- Pickup and destination both require active service-zone coverage and valid location data.
- Existing payment/refund activation safeguards remain disabled unless separately authorized.
- Booking, delivery and settlement are separate lifecycle concerns.

## 3. Flow

### Quote before MarketIQ payment
MarketIQ requests a quote for each seller fulfilment before customer payment. Logistic Hub validates pickup/destination coverage, partner agreement/rate card, parcel constraints and quote expiry. Quote binds to exact external order/seller-order/fulfilment references and the submitted shipment details.

MarketIQ persists the accepted quote and delivery charge, then includes delivery charge in checkout/payment total. **Do not rely on post-payment quote calculation:** MarketIQ checkout currently has zero shipping total, so charging the customer first and quoting later would leave checkout under-collected or require an unauthorized second charge.

### Booking after verified MarketIQ payment
After MarketIQ verifies Paystack payment, it submits a booking request using the accepted quote. Logistic Hub verifies client identity, quote ownership/version/expiry, billing agreement and idempotency, then creates/reuses the booking. It must not treat MarketIQ's payment reference as a Logistic Hub Paystack payment.

## 4. Proposed API surface (not implemented)

- `POST /api/v1/integrations/marketplace/quotes`
- `POST /api/v1/integrations/marketplace/shipments`
- `GET /api/v1/integrations/marketplace/shipments/:shipmentReference`
- Authenticated lookup by external fulfilment reference for recovery.

All routes are service-to-service authenticated and scoped to the `MARKETIQ` client. Booking create requires `Idempotency-Key`.

### External references
- `sourceSystem = MARKETIQ`
- `externalOrderReference`
- `externalSellerOrderReference`
- `externalFulfillmentReference` (unique booking intent)
- `externalSellerReference`
- `externalCustomerReference`
- `externalWarehouseReference`
- `externalQuoteReference`

The uniqueness boundary is `(sourceSystem, externalFulfillmentReference)`. Same idempotency key and same canonical request returns the original booking; same key with changed payload returns conflict. IDs remain opaque strings.

### Quote request
Must include external refs, pickup and destination snapshots, verified coordinates, service-zone references, parcel details, currency and billing agreement reference.

Quote response must include quote reference/version, expiry, customer delivery charge, agreed logistics cost when contractually available, currency, billing agreement and validation outcome. Quote binds to submitted shipment details. Material changes require a new quote.

### Booking request
Must include external refs, accepted quote reference/version, immutable pickup/destination/recipient/parcel snapshots, delivery charge, logistics cost, currency, billing agreement and MarketIQ payment audit reference. The payment reference is audit metadata only, not authorization to charge or settle funds.

### Booking response
Return internal Logistic Hub booking reference, external fulfilment reference, tracking reference, status and accepted commercial snapshot.

## 5. Monetary representation

Integration API uses NGN minor units (kobo) as integer decimal strings; no floating-point money.

MarketIQ's current Prisma commerce fields use Decimal naira, while Logistic Hub API money uses minor-unit strings. LI-02 must convert exactly and test precision/round trips. Do not reinterpret existing Decimal values as kobo.

Preserve distinct:
- buyer delivery charge
- agreed provider logistics cost
- total buyer order payment
- platform margin/subsidy, discounts, taxes and adjustments

Quote-time amounts and billing agreement version are immutable snapshots.

## 6. Webhook contract

Proposed Logistic Hub → MarketIQ:
`POST /api/v1/integrations/logistic-hub/webhooks`

Required headers:
- `X-LogisticHub-Key-Id`
- `X-LogisticHub-Timestamp`
- `X-LogisticHub-Signature`
- `X-LogisticHub-Event-Id`

Signature canonicalization must be identical in both implementations. Draft v1: HMAC-SHA256 over `timestamp + "." + raw request body`. Use timing-safe comparison, timestamp tolerance, key ID and controlled key rotation.

Payload includes event ID/type, schema version, occurred-at timestamp, shipment/internal booking reference, external fulfilment reference, per-shipment monotonic sequence and status/milestone details.

MarketIQ must deduplicate by provider/event ID, reject replay/stale sequence, persist receipt/audit, and apply events idempotently. Logistic Hub must retry delivery and expose failed webhook attempts. Events may update logistics tracking projection only; they must not directly trigger MarketIQ customer payment, refund, seller settlement or order completion.

## 7. Initial event categories

- booking accepted / booking rejected
- pickup scheduled / picked up
- hub intake / hub release / custody handover
- in transit / delayed / exception opened / exception resolved
- out for delivery / delivered / delivery failed
- cancelled / returned, only where supported by the actual Logistic Hub lifecycle

Exact event identifiers and legal transition map are LI-03 implementation deliverables.

## 8. Security and controls

- Dedicated revocable service credentials; no customer JWTs.
- Scope credentials to integration client and permitted operations.
- Secret storage/rotation via deployment secrets, not code or logs.
- Validate schemas, rate limits, external reference ownership and quote state.
- Do not allow external client to choose internal sender, driver, partner, hub or booking status.
- Do not enable Paystack payments/refunds as part of this adapter.
- Do not accept client-authoritative delivery status or settlement state.

## 9. Required persistence and behavior

Logistic Hub needs integration-client identity/credentials, external booking reference mapping, billing agreement linkage/snapshot and webhook delivery audit. Exact Prisma models/indexes/migrations are LI-03 schema design; avoid speculative schema changes before implementation.

The booking record must retain:
- source system and external references
- external quote reference/version
- request idempotency key and canonical request hash
- accepted delivery charge and logistics cost
- billing agreement reference/version
- quote/booking snapshots
- integration audit timestamps

Webhook delivery requires durable event records, retry/backoff, delivery attempts, terminal failure visibility and safe replay.

## 10. Operational rules

- Quote validity and active service-zone eligibility are checked at quote and booking time.
- Warehouse-to-provider location mapping is explicitly managed by MarketIQ; Logistic Hub validates its own coverage.
- Delivery does not equal settlement.
- Manual reconciliation is v1. Do not automate partner settlement until cancellation, failed delivery, return, refund and cost-variance handling is proven.
- Integration outages must not roll back a verified paid MarketIQ order; expose pending/failed booking status and recover using same idempotency key.
- Never create duplicate bookings or customer charges after timeout/retry.

## 11. LI-02/LI-03 implementation checklist

### MarketIQ LI-02
- Add provider/quote/shipment/event/webhook receipt models.
- Add pre-payment quote and quote acceptance to checkout.
- Persist shipping charge before Paystack initiation and include it in the order total.
- Add stable per-fulfilment booking intent and post-payment outbox processing.
- Add integration status visibility and safe retry.

### Logistic Hub LI-03
- Add integration-client auth and scope.
- Add external identity/reference mapping.
- Add marketplace quote/booking/lookup routes.
- Reuse partner pricing and coverage validation.
- Add platform-funded booking path without customer payment initialization.
- Add webhook event outbox, signing, retry and audit.

### LI-04/05/06
- End-to-end idempotency/replay tests.
- Webhook signature, duplicate, stale/out-of-order and key-rotation tests.
- Manual logistics payable reconciliation report and exception matrix.
- Deployment secrets/runbook and operational readiness review.

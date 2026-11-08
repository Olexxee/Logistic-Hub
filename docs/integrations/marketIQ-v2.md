# MarketIQ Integration Contract v2 — Generic Logistic Hub Boundary

**Status:** Cross-system contract v2. LI-02G-A private packing evidence is implemented on the current cross-repository PR branches and awaits CI/review/merge. LI-02G-B buyer review, cancellation instructions and dispatch authorization remain unimplemented pending explicit policy decisions.

**Relationship:** This document specializes the [Generic Logistics Integration API](generic-logistics-integration-v1.md). It supersedes conflicting MarketIQ-specific v1 assumptions about external customer/seller user creation, customer email collection and Hub-side Paystack verification. It does not create MarketIQ-only business logic in the generic API.

## 1. Core boundary

MarketIQ and Logistic Hub are independently deployable systems with separate databases and authoritative domains.

| Concern | Authority |
|---|---|
| Buyer/seller accounts, authentication, catalogue and orders | MarketIQ |
| Customer payment verification, refunds and seller enforcement | MarketIQ |
| Buyer review and cancellation decisions | MarketIQ |
| Logistics quote, shipment acceptance and operational execution | Logistic Hub |
| Hub, partner, rider, route, custody and delivery state | Logistic Hub |
| Cross-system event reference and local projection | Receiving system, without owning the source event |

The generic integration client is authenticated by Logistic Hub's existing service credential mechanism. Authenticated integration-client identity is authoritative; a body field such as sourceSystem must never override it.

## 2. Trust model: authenticated payment authorization

MarketIQ is the financial authority for its customer payment. Logistic Hub trusts a valid authorization from the authenticated MarketIQ integration client and does not independently call Paystack or create a customer payment.

The authorization is a statement from the trusted client that its payment verification succeeded. Logistic Hub still performs its own contract and operational validation:

- Authenticated client is active and has shipments:write.
- External fulfilment reference is unique within that client.
- Accepted quote session/option belongs to the client and is still eligible.
- Billing agreement is active and the accepted snapshot is valid.
- Payment reference is present as an external reference.
- Payment state is explicitly VERIFIED.
- Verified timestamp is valid and within the permitted policy.
- Currency and exact delivery-charge minor units match the accepted quote.
- Shipment/package/recipient/location snapshots satisfy quote and booking contract.
- Canonical request hash matches any previous use of the idempotency key.

The Hub must not verify the customer's payment-provider transaction independently. It must not treat a caller-supplied payment reference without authenticated client context and the full authorization contract as sufficient.

A repeated identical request returns the existing shipment. Same idempotency key with a different payload is a conflict. A timeout after Hub commit is recovered through the existing client-scoped external-reference lookup.

MarketIQ must notify the Hub of refunds, reversals, disputes and cancellation decisions. The Hub applies operational actions according to assignment/custody state and returns the actual outcome; it does not issue customer refunds or change MarketIQ's payment ledger.

## 3. No mirrored MarketIQ users

Do not create a Logistic Hub customer or sender user for every MarketIQ buyer. Do not require MarketIQ customer email, account ID, password, JWT or seller login details.

The Hub stores integration-owned shipment records linked to the authenticated integration client and opaque external references. It receives only shipment-operational data:

- External MarketIQ order and seller-fulfilment references.
- Accepted quote, payment authorization and billing-agreement references.
- Pickup address/coordinates and operational pickup contact if needed.
- Recipient name, phone, delivery address and coordinates.
- Seller/warehouse display or pickup contact only where needed.
- Goods manifest, package measurements, handling flags and declared value where required.
- No unrelated platform account or shopping-history data.

The buyer and recipient may be different people. A delivery recipient is an operational contact, not a Logistic Hub user account. The Hub must not create synthetic user rows simply to satisfy legacy sender-based booking code; the integration-owned booking path remains sender-user independent.

## 4. Goods manifest and four packing photographs

MarketIQ supplies a structured manifest for the seller fulfilment: external line reference, product name/SKU where available, variant, quantity, mapped category, handling-relevant description, declared value where required, package association and measurements with explicit units/source.

**Only packing photographs are in scope. Catalogue/product listing images are not required. Maximum four photographs per seller fulfilment/shipment:**

1. Full contents visible together.
2. Product/variant identifying details.
3. Quantity/accessory verification.
4. Final packed/sealed parcel before handover.

The photographs are packing evidence, not proof of delivery. Each evidence record needs external fulfilment/shipment reference, evidence slot/type, capture timestamp, actor reference, checksum, content type, byte size, upload/verification status and version. Replacements must be versioned and audited; originals must not be silently overwritten.

LI-02G-A implements private server-to-server binary transfer; no image bytes are embedded in shipment JSON and no permanent public object URL is exposed. MarketIQ seller upload is `POST /api/seller/fulfillments/:fulfillmentId/packing-evidence` (one multipart `image`, one `slot`, and an `Idempotency-Key`). MarketIQ verifies active seller ownership, paid order, pre-dispatch fulfilment and booked Hub shipment. Hub ingestion is `POST /api/v1/integrations/shipments/by-external-reference/:externalFulfillmentReference/packing-evidence`, requires `shipments:write`, and receives `application/octet-stream` plus explicit evidence metadata headers. Hub accepts JPEG/PNG/WebP up to 5 MiB, validates file signatures, calculates SHA-256 and stores an authenticated/private Cloudinary asset. The four slots are `CONTENTS_OVERVIEW`, `PRODUCT_DETAILS`, `QUANTITY_CHECK` and `SEALED_PARCEL`; replacements increment a slot version and preserve prior objects. Buyer listing returns the latest version per slot. Hub list/download endpoints require `shipments:read`, and downloads are scoped to both client and external fulfilment reference. MarketIQ buyer endpoints authorize ownership and proxy the image; no Cloudinary URL is sent to the browser. Hub records an internal BookingEvent for each accepted evidence version. No Hub webhook event for evidence is currently emitted; buyer reads use the authenticated MarketIQ proxy.

## 5. Buyer review and cancellation instructions

MarketIQ owns the buyer-facing review window, buyer communications and cancellation/refund decision. Logistic Hub owns physical execution.

After packing evidence is accepted and recorded, the buyer retrieves the latest evidence through MarketIQ's authenticated proxy. LI-02G-A does not emit a new Hub webhook event or create a buyer review timer. If the buyer raises an issue or requests cancellation, MarketIQ will send an authenticated, idempotent operational instruction (for example, hold/cancel/return request); the exact action vocabulary and endpoint must be designed and versioned in LI-02G-B.

The review duration, expiry behavior and automatic-approval rule are not yet approved. The Hub must not invent a timeout or independently decide that buyer review has expired. The Hub must not proceed to a gated dispatch milestone until it has the required MarketIQ authorization defined by the contract.

A cancellation request is not proof that a shipment has been cancelled. If a rider has collected the parcel or it is in transit, the Hub reports actual custody and performs only feasible actions such as stop, hold, return to seller or return to hub. MarketIQ alone decides customer refund and order cancellation state.

## 6. Cross-system event references

The Hub's event ledger records Hub-owned operational events and may also retain references to authenticated external events. It must not copy MarketIQ internal order/payment state into Hub-owned domain tables.

External event envelope requirements:

- Source client derived from authenticated credential.
- Source event ID unique within the client.
- Event type and schema version.
- Source occurrence timestamp and Hub receipt timestamp.
- External order and fulfilment references.
- Correlation/causation references where available.
- Minimal event data required for the Hub's operational response.

For events received from MarketIQ, deduplicate by client + external event ID, preserve source timestamps and payload digest, and audit the resulting operational action. For Hub events sent to MarketIQ, use the existing signed webhook delivery system and monotonic shipment sequence. Receivers verify signatures over raw bytes, enforce timestamp tolerance, deduplicate and reject stale sequence updates.

Examples of MarketIQ-owned events include PAYMENT_VERIFIED, PAYMENT_REFUNDED, PAYMENT_REVERSED, BUYER_CANCELLATION_REQUESTED, BUYER_REVIEW_APPROVED and PACKING_EVIDENCE_SUBMITTED. These are illustrative contract vocabulary only; do not emit them until both sides implement the versioned schema and subscription behavior.

Examples of Hub-owned events include shipment accepted, rider assigned, pickup, hub custody, transit, delivery and packing-evidence receipt. The Hub does not use its event to mark MarketIQ payment or order complete.

## 7. Privacy, security and evidence controls

- Integration credentials remain client-scoped, revocable, rotatable and least-privilege.
- Payment authorization and cancellation instructions require authenticated scopes, idempotency, replay protection and audit records.
- Do not log secrets, signed media URLs, card data, full raw payment payloads or unnecessary recipient PII.
- Encrypt media at rest and in transit; authorize access by client + shipment + evidence reference.
- Retain operational personal data and evidence only for documented business, dispute and legal-retention purposes.
- Do not expose internal partner costs, private recipient data or full addresses through generic integration tracking reads unless a specific scope/field policy permits it.
- Seller fraud adjudication and seller-contract enforcement remain MarketIQ responsibilities. Logistic Hub preserves operational evidence and reports factual custody/packing events; it does not determine criminal guilt.

## 8. Commercial and operational invariants

- MarketIQ is the platform-funded customer-payment collector.
- Hub logistics cost is owed under a versioned billing agreement; shipment creation does not settle it.
- Customer charge, Hub cost, platform subsidy/margin and seller payable remain separate.
- Exact integer minor-unit strings and explicit currency are used; no floating-point money.
- One shipment per MarketIQ SellerOrder remains the initial integration rule.
- Current quote limitations (including rejecting line quantity greater than one until packing is defined) remain in force until code and tests explicitly change them.
- No synthetic sender, no customer email requirement, no second customer charge, no provider-side Paystack verification, no shared database.
- Rider assignment/activation is Hub-owned and subject to operational availability and state-machine constraints; MarketIQ payment success does not fabricate a rider or guarantee immediate pickup.

## 9. Implementation sequencing and acceptance gates

1. MarketIQ LI-02D: verified payment transaction writes shipment-authorization outbox events atomically; buyer response does not wait for Hub.
2. Hub booking authorization alignment: ensure existing shipment creation validates MarketIQ payment authorization and accepted quote without Paystack verification or synthetic sender identity.
3. MarketIQ LI-02E / Hub: idempotent worker delivery, shipment creation/recovery, dispatch activation and failure recovery.
4. LI-02F: signed packing-evidence, shipment and cancellation coordination events; MarketIQ projection and monotonic event application.
5. LI-02G-A: private media transfer, four typed evidence slots, checksum/version validation, durable private storage and buyer-view authorization (current PR branches; CI and merge pending).
6. LI-02G-B: approved review-window policy, cancellation command contract, custody-aware stop/hold/return actions and refund coordination.
7. LI-02G-C: staging end-to-end, privacy review, seller accountability policy, reconciliation and operational runbooks.

Do not claim any new API route, database model, media transfer, buyer screen, review timer or cancellation behavior is implemented until code, tests and both sides of the contract exist. The generic integration API must remain reusable for other clients; MarketIQ-specific semantics belong in a client contract/configuration, not hard-coded generic domain logic.

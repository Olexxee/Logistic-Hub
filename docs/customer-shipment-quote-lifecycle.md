# CBP-03 — Customer shipment quote assessment and acceptance

## Purpose

Ordinary Logistic Hub parcel bookings and MarketIQ integration shipments use the same underlying route and tariff rules. The customer-facing interfaces remain separate; the pricing authority does not.

The customer quote flow reuses the existing `ShipmentQuote` model and quote list/accept/reject lifecycle. It does not introduce a second quote table or require an IntegrationClient or integration billing agreement.

## Customer API

- `POST /api/v1/parcel-bookings/:bookingId/quotes` — assess the server-owned route and package facts, then issue a versioned quote when a complete approved tariff exists.
- `GET /api/v1/parcel-bookings/:bookingId/quotes` — list quote versions for the authenticated booking owner.
- `POST /api/v1/parcel-bookings/:bookingId/quotes/:quoteId/accept` — accept an unexpired quote.
- `POST /api/v1/parcel-bookings/:bookingId/quotes/:quoteId/reject` — reject an offered quote.

Quote issue defaults to a 15-minute expiry. The caller may request 5–1,440 minutes. A newly issued quote supersedes earlier offered versions. Only the booking owner may request or accept a customer quote.

## Assessment rules

### LOCAL_DIRECT — platform-operated route

- Uses the shared `assessPlatformRouteTariffs` service already used by the MarketIQ integration quote path.
- Requires an enabled, effective, directed `PlatformRouteAvailability` record.
- Requires exactly one active, effective platform route tariff for every package.
- Package category, weight and any tariff dimension limits must match.
- Missing weight returns `REQUIRES_MEASUREMENT`; no estimated weight is fabricated.
- Missing corridor approval returns `REQUIRES_OPERATIONAL_PRICING`.
- Customer transport charge and platform charge are returned as separate line items.
- Driver payout and internal tariff snapshots are persisted internally and are not returned in customer quote resources.

### END_TO_END — contracted partner route

- Uses active, effective partner rate cards under active agreements for active, verified partners.
- A single rate card must cover every package; each package must have exactly one matching rate within that card.
- The lowest complete customer total is selected deterministically.
- Platform charge uses the effective pickup-zone or global legacy platform connection-fee rule. If that charge is not configured, the service fails closed rather than inventing a zero or arbitrary charge.
- Partner and per-package rate identifiers are retained in the internal quote snapshot, not exposed in customer quote resources.

### HUB_ASSISTED

A hub-assisted route is not quoted until approved pricing exists for pickup, inter-hub transport, hub handling and destination final-mile execution. The endpoint returns `REQUIRES_OPERATIONAL_PRICING`; it does not add a partial quote or substitute a direct route.

## Acceptance and fulfilment boundary

Acceptance is transactional and rechecks the offered quote status, expiry, route availability and platform tariff identity/version/amounts.

- Platform-priced LOCAL_DIRECT quote: the quote is accepted, the route plan is persisted, the customer total is snapshotted, and the booking moves to `AWAITING_PARTNER_ASSIGNMENT`.
- Partner END_TO_END quote: the existing partner quote acceptance behavior is retained. Partner assignment and settlement remain a separate operational capability.

A platform-priced quote acceptance does **not** initialize payment, mark a driver assigned, or dispatch an offer. Payment initialization currently requires a real driver assignment and agreed driver allocation. CBP-04 must connect ordinary customer platform-priced bookings to fixed-payout dispatch before payment can proceed.

## Draft creation and legacy compatibility

Parcel booking draft creation now persists validated location and package facts even when no legacy pickup-zone `PricingRule` exists. In that case the booking is created in NGN with no provisional customer charge and a pricing snapshot of `AWAITING_ROUTE_QUOTE`.

The legacy negotiated-fare matching path is blocked for bookings without a legacy pricing rule. Existing bookings with legacy pricing configuration retain the transitional negotiated-fare path until CBP-04 completes the ordinary customer fixed-payout migration. New route quotes never derive customer price from the legacy pickup-zone rule for LOCAL_DIRECT tariffs.

## Non-goals and operational safeguards

- No production route availability, tariff, partner agreement, rate card, hub pricing or driver payout configuration is created or activated.
- No payment or bank settlement is initiated by quote issue or platform quote acceptance.
- No package weight is estimated.
- No customer API response contains driver payout.
- No route is considered bookable merely because both endpoint zones are active; the directed corridor and matching tariff must also be active.

## Verification

The CBP-03 test suite covers successful platform quote creation, customer payout confidentiality, missing measurements, unavailable directed corridors, ownership enforcement and booking-state enforcement. CI must additionally validate Prisma, OpenAPI, migration/schema drift, and the full backend test suite before merge.

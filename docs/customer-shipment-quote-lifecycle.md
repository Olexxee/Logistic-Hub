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

## CBP-04 — ordinary customer fixed-payout dispatch

A platform-priced LOCAL_DIRECT customer booking now uses the existing delivery-leg dispatch and payment reservation lifecycle. The customer quote acceptance persists the accepted quote source, quote ID/version, customer total and exact internal driver payout in the booking pricing snapshot. The payout is also pinned to the LOCAL_PICKUP leg.

### State sequence

1. Customer accepts the active, unexpired platform tariff quote. The booking moves to `AWAITING_PARTNER_ASSIGNMENT`; no payment or driver assignment is created yet.
2. The booking owner requests matching for the LOCAL_PICKUP leg. The backend requires the accepted platform quote snapshot, positive fixed payout, active directed route availability and active endpoint zones. Offers carry the tariff's fixed payout; drivers cannot propose a different fare.
3. An eligible driver accepts with an explicit active verified vehicle. The backend rechecks the driver profile, KYC, capability, documents, current location, vehicle, service-zone coverage, route availability, offer expiry and exact payout snapshot. The driver is reserved and an assignment is created in `AWAITING_PAYMENT`; the leg and booking move to `AWAITING_PAYMENT`. A 15-minute payment reservation expiry is applied.
4. The customer initializes Paystack payment. The existing payment service requires that assignment, the matching payable total, and an active Paystack settlement subaccount for the assigned driver. For platform-route bookings, the reserved assignment payout must exactly match the accepted quote's internal driver payout.
5. A verified successful Paystack webhook moves the booking to `DRIVER_ASSIGNED`, activates the assignment and delivery leg, and records the payment ledger entries. Failed or expired payment does not mark the booking as assigned.
6. Delivery completion creates/reuses the existing pending driver payout record. This is a payout liability, not an automatic bank transfer; settlement execution remains a separate operational step.

### Payment allocation and confidentiality

- Customer payment amount remains the accepted quote total; driver payout remains the tariff's exact fixed payout.
- The Paystack split allocates the agreed driver amount to the driver's active settlement subaccount and the remainder to the platform. The payment snapshot labels this platform-route remainder as `PLATFORM_RETAINED_REMAINDER`, not as a legacy fixed connection fee.
- Driver payout and internal tariff details remain absent from customer quote and booking resources.
- A customer-owned booking cannot use the integration release path. Integration-owned shipments retain their existing paid-and-released dispatch gate and immediate assignment behavior.
- Fixed-payout acceptance is idempotent per accepting driver and offer. Competing acceptance, changed payout snapshots, inactive routes, stale driver eligibility, or changed booking state fail closed.

### Operational limitations

- This flow does not make a route operationally ready by itself. Active tariffs, route availability, eligible drivers, active verified vehicles and driver Paystack settlement subaccounts are still required.
- No production route, tariff, driver, settlement account, or payment configuration is created or activated by this change.
- A pending driver payout is not proof of completed settlement or bank transfer.

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

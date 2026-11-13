# Hub-assisted operational tariffs — technical design

**Workstream:** HAT-01  
**Branch:** `feat/hub-assisted-operational-tariffs`  
**Status:** Design approved; schema implementation not yet started  
**Base:** `27fa2887e4c03c7dc453f8631b42a02d4be4ad93`

## 1. Purpose

Introduce reusable, ADMIN-published tariffs for hub-assisted parcel routes. The system must calculate the customer price from the resolved operational route, one operational leg or handling event at a time.

This is a separate pricing domain from `PlatformRouteRate`, which remains the direct zone-to-zone tariff model.

## 2. Locked commercial decisions

1. Local pickup and final-mile delivery use service-zone tariffs.
2. Hub-to-hub transportation uses a directed origin-hub/destination-hub tariff.
3. Hub handling uses a tariff associated with the handling hub.
4. Each scope is independently configured; no scope can substitute for another.
5. Tariffs determine customer charges only. They do not contain driver payouts, partner execution costs, executor identities, or partner agreement terms.
6. Platform-managed driver compensation is resolved from the applicable platform driver payout rules.
7. Partner execution costs are resolved only from valid partner agreements / contracted commercial terms.
8. If a required execution cost or eligible executor cannot be resolved, the quote may be commercially priced but the operational plan must be flagged as requiring review; no cost may be inferred from the customer charge.
9. Missing customer tariff coverage produces no automated quote. No direct tariff, legacy fare, or arbitrary amount is used as fallback.
10. Existing direct pricing, contracted END_TO_END pricing and one-off ADMIN operational quotes remain separate paths.

## 3. Existing foundations verified

- `PlatformRouteRate` represents directed service-zone corridors and includes customer transport charge, platform charge and a driver payout. It cannot safely represent same-zone pickup/final-mile pricing or hub-specific handling.
- `PlatformRouteAvailability` is directed zone-to-zone availability. It should not be overloaded with hub-pair or hub-handling availability.
- `HubPoint` identifies a hub and its service zone. Hub status, accepted parcel types and capacity configuration remain independent operational eligibility checks.
- `resolveDeliveryRoute()` supplies server-resolved route mode and operational legs. The pricing engine must consume this route topology, not independently choose hubs.
- `DeliveryLeg` persists leg type, zone/hub endpoints and metadata. Its accepted quote snapshot remains the source for historical commercial terms.
- Customer and integration quote services currently return `REQUIRES_OPERATIONAL_PRICING` for hub-assisted paths. Both should call the new shared assessment service when the feature is enabled.
- Admin one-off operational pricing already supports manually priced legs and must remain available as an exception workflow.

## 4. Proposed data model

Introduce a dedicated tariff model, tentatively `PlatformOperationalTariff`, and a separate availability model, tentatively `PlatformOperationalTariffAvailability`. Final names and field constraints must be validated against Prisma conventions and migration review before implementation.

### 4.1 Tariff identity and scope

A tariff has exactly one scope:

| Scope | Required locator | Use |
|---|---|---|
| `LOCAL_ZONE` | `serviceZoneId` | `LOCAL_PICKUP` and `FINAL_MILE` |
| `HUB_PAIR` | `originHubPointId`, `destinationHubPointId` | `INTERSTATE_TRANSPORT` |
| `HUB_HANDLING` | `hubPointId` | Handling at a hub |

A `LOCAL_ZONE` tariff must additionally specify the eligible operational leg type, so pickup and final-mile pricing can differ within the same zone. A `HUB_PAIR` tariff is directional; reverse travel requires its own tariff. A `HUB_HANDLING` tariff is associated with the hub where the handling event occurs.

All scopes also require service type, canonical parcel category, currency, canonical weight-band boundaries, optional maximum dimensions, effective window, version, status, publication timestamp, creator and audit reason.

Use explicit nullable locator columns with database check constraints enforcing exactly the locator combination required by the selected scope. Do not encode the scope locator in unvalidated JSON.

### 4.2 Customer charge representation

Tariffs contain customer-facing charge components only. Preserve integer minor-unit storage (`BigInt`) and avoid floating-point calculations.

Recommended fields:
- `customerTransportChargeMinor` for the customer-facing charge attributable to that operational leg.
- `platformChargeMinor` for an explicitly configured platform component, defaulting to zero if the commercial policy confirms it is applicable.
- For hub handling, use a customer handling charge component rather than pretending it is transport.

The assessment engine calculates each component once and maps the canonical breakdown into the existing quote fields. Do not double count pickup/final-mile charges as both transport and collection/destination charges. The exact mapping to `ShipmentQuote` totals must be confirmed during HAT-03 against the existing quote DTO and ledger/payment consumers.

No tariff field may represent driver payout, partner execution cost, executor ID, partner ID, or agreement ID.

### 4.3 Availability

Availability is separate from tariff publication. The proposed availability model should support the same scope locators and effective windows, with a unique key per scope + locator + leg type + service type.

Publishing a tariff requires:
- Active/serviceable service zone or hub endpoints.
- An enabled, currently effective availability record for the exact scope and locator.
- A valid effective window.
- Canonical weight band and category.
- No overlapping active coverage for the same scope, locator, leg type, category, currency and weight band.

A hub's active status and operational capacity remain separate checks. Availability does not guarantee that a specific hub has capacity at quote time.

## 5. Assessment contract

Create `platform-operational-tariff-assessment.service.js` as a transaction-scoped domain service.

Input:
- Prisma transaction client.
- Resolved route object from `resolveDeliveryRoute()`.
- Server-validated packages, including category, integer grams and any required dimensions.
- Currency, assessment timestamp and quote expiry.

Processing:
1. Reject missing or invalid package measurements; do not estimate.
2. Verify route mode is `HUB_ASSISTED` and route legs are structurally valid.
3. Match pickup tariff by pickup service zone and `LOCAL_PICKUP`.
4. Match directed hub-pair tariff for every interstate leg.
5. Match handling tariffs for each actual handling event represented by the route/custody plan. Do not assume every hub visit incurs a charge; handling events must be explicit and deduplicated.
6. Match final-mile tariff by destination service zone and `FINAL_MILE`.
7. Require exactly one tariff match for every required package × chargeable operation. Missing matches return a no-coverage result; multiple matches return an ambiguity result.
8. Aggregate customer amounts with BigInt arithmetic.
9. Resolve execution-cost eligibility independently. Platform driver payout rules and partner agreements are not tariff inputs. If unresolved, return a separate operational-readiness warning/status; never derive internal costs from customer prices.
10. Return a canonical per-package/per-leg/per-handling breakdown and immutable tariff snapshot.

The service must not create quotes, assign executors, create delivery legs or write ledger entries. Callers own persistence and lifecycle transitions.

## 6. Quote lifecycle and snapshot

The customer and integration quote services call the same assessment service within their existing transaction boundaries.

The quote snapshot must preserve:
- Route mode, route plan version and selected hub IDs.
- Ordered leg definitions and hub/zone endpoints.
- Package IDs/references, categories, measured weights and dimensions.
- Every matched tariff ID, version, scope, locator, effective window and charge components.
- Per-package and per-operation amounts.
- Aggregate customer quote totals.
- Assessment timestamp and currency.
- Separate execution-readiness result and resolved execution-cost source/version, only where such cost is legitimately resolved.

At acceptance:
- Validate ownership, booking state, quote status and expiry.
- Revalidate route topology and operational eligibility.
- Confirm tariff identities/versions and computed customer totals remain consistent with the offered quote; otherwise require a fresh quote.
- Resolve or revalidate executor eligibility and internal cost separately.
- Persist the accepted snapshot and create delivery legs from the same pinned route.
- Preserve existing dispatch, payment, partner assignment and settlement boundaries.

A tariff update must never rewrite an already accepted quote.

## 7. Admin API and UI direction

Extend the existing ADMIN platform route-pricing workspace with a distinct hub-assisted operational tariffs section. Do not create a duplicate pricing workspace.

Proposed API resource family:
- `GET /admin/platform-operational-pricing/tariffs`
- `POST /admin/platform-operational-pricing/tariffs` (creates DRAFT)
- `POST /admin/platform-operational-pricing/tariffs/:tariffId/publish`
- `POST /admin/platform-operational-pricing/tariffs/:tariffId/retire`
- `GET /admin/platform-operational-pricing/availability`
- `POST /admin/platform-operational-pricing/availability`

All mutations require ADMIN authorization, reason, validation, transaction safety and audit events. Listing should filter by scope, leg type, zone/hub, category and status. API response amounts remain integer-minor-unit strings.

The frontend must display scope-specific selectors and must never expose internal driver or partner costs as customer tariff fields.

## 8. Failure and fallback behavior

- Missing any required customer tariff: no automated quote; return a precise coverage gap and route to the existing one-off ADMIN pricing workflow where applicable.
- Ambiguous tariff coverage: fail closed and alert administrators; do not select the cheapest or newest arbitrarily.
- Missing package weight/dimensions required by a tariff: return `REQUIRES_MEASUREMENT`.
- Weight above the canonical 30 kg ceiling: manual freight assessment.
- Inactive hub, unavailable corridor, or insufficient operational capacity: do not issue an executable quote.
- Missing executor cost: preserve the customer quote only if product policy permits a non-executable offer; otherwise require operational review before offering. This policy must be finalized in HAT-03 before wiring customer lifecycle.
- Never fall back from hub-assisted pricing to a direct corridor tariff or legacy `PricingRule`.

## 9. Test and release gates

- Schema validation and migration drift checks.
- Scope locator constraints and uniqueness.
- Availability and publication effective-window checks.
- Overlap and ambiguity rejection.
- Canonical weight-band boundaries, gaps and >30 kg behavior.
- Multiple packages, mixed categories and package-specific tariff matching.
- Same-zone pickup/final-mile, directed hub-pair, and multiple handling events.
- No duplicate handling charges.
- BigInt totals and string serialization.
- No execution-cost leakage into customer charge.
- Missing driver payout rule and missing partner agreement.
- Route/hub change between quote and acceptance.
- Tariff version change between quote and acceptance.
- Quote replay and idempotency.
- Direct route, contracted partner, one-off operational quote and existing dispatch regression.
- OpenAPI, docs, full backend tests and CI all pass before merge.

## 10. Phased delivery

- **HAT-01:** approve and implement schema + migration + lifecycle invariants.
- **HAT-02:** ADMIN tariff and availability API.
- **HAT-03:** shared per-leg assessment engine and execution-readiness contract.
- **HAT-04:** customer quote lifecycle integration.
- **HAT-05:** integration quote lifecycle integration.
- **HAT-06:** admin UI extension.
- **HAT-07:** regression, operational acceptance and documentation.

This document records the approved design direction. It does not claim that the schema, API, assessment engine or UI have been implemented.

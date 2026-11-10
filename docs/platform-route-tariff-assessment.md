# Shared platform route tariff assessment

## Purpose

The platform route tariff assessment is the shared pricing primitive for platform-operated directed parcel corridors. Ordinary Logistic Hub customer bookings and integration clients must use the same tariff eligibility and arithmetic. Client identity, billing agreement, quote persistence, payment ownership, and event delivery remain at their respective boundaries.

## Contract

```js
assessPlatformRouteTariffs({
  tx,
  originServiceZoneId,       // server-resolved
  destinationServiceZoneId,  // server-resolved
  packages,                  // validated category, measured weight, optional dimensions
  currency,
  now,
  routeSnapshot,
  expiresAt,
});
```

The caller supplies a transaction-scoped Prisma client and a route snapshot produced by the server route planner. The function does not trust client-supplied zone IDs, route mode, tariff IDs, prices, or payout values.

## Assessment outcomes

| Status | Meaning |
|---|---|
| `QUOTED` | Every package has exactly one matching effective tariff and the directed corridor is enabled. |
| `REQUIRES_MEASUREMENT` | At least one package has no valid positive measured weight. |
| `REQUIRES_OPERATIONAL_PRICING` | The directed corridor has not been explicitly enabled. |
| `NO_COVERAGE` | At least one package has no matching active tariff. |
| `PRICING_AMBIGUOUS` | More than one active tariff matches a package. |

A quoted assessment contains an internal per-package tariff snapshot, aggregate customer transport charge, platform charge, and driver payout. Driver payout is internal fulfilment data and must not be copied into customer-facing responses.

## Matching rules

- Origin and destination are a directed pair; the reverse corridor is a different route.
- Only effective `PARCEL_DELIVERY` route availability is accepted.
- Tariffs must match the directed pair, parcel category, currency, active status, and effective dates.
- Package weight must be a positive integer in grams and fall inside the tariff's inclusive weight band.
- A configured dimension limit requires the corresponding measured dimension and rejects packages above the limit.
- Every package must match exactly one tariff. Missing or overlapping matches fail closed.
- Aggregate amounts use integer minor units / Prisma `BigInt`; API adapters serialize amounts as decimal strings.

## Boundaries

This service prices platform-operated local direct routes only. It does not price partner rate cards, hub handling, inter-hub transport, collection, or final-mile legs. Those execution topologies require their own explicit operational pricing and dispatch models. A published tariff does not prove driver capacity or authorize dispatch.

## Current integration

The integration quote service delegates its `LOCAL_DIRECT` tariff assessment to this shared service. Its external response shape and the partner-rate-card `END_TO_END` path remain unchanged. Ordinary customer booking integration is a subsequent CBP implementation step.

## Validation

Unit tests cover a unique tariff match, missing package weight, disabled/missing directed corridor, overlapping tariff matches, and package dimensions exceeding tariff limits. Integration quote tests continue to cover the external quote response and private payout persistence.

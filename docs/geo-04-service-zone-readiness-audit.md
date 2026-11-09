# GEO-04 — Service-zone readiness and overlap audit

**Status:** Backend endpoint and frontend Admin panel are merged. Code is deployed on the main Render service; staging/data acceptance remains blocked pending an isolated staging environment and authorized read-only access to its database.
**Dependency:** GEO-03 coordinate resolution is merged in backend PR #138 and customer booking integration is merged in frontend PR #60.

## Purpose

Give Admin a read-only operational audit before enabling parcel service in a zone. The audit identifies missing/invalid boundaries, inactive geography, inactive service availability, missing effective pricing, missing configured driver coverage, and overlaps between active zone boundaries.

## API

- `GET /api/v1/service-zones/admin/readiness?serviceType=PARCEL_DELIVERY`
- Requires authentication and `ADMIN` role.
- `serviceType` defaults to `PARCEL_DELIVERY` and accepts the existing `ServiceType` enum.
- The endpoint is read-only. It does not change zone activation, availability, pricing, boundaries, driver coverage, or bookings.

## Readiness semantics

- `bookingReady` requires an active zone, active state/country, valid boundary, currently effective availability for the requested service, and at least one effective zone-specific or global fallback pricing rule.
- Missing and invalid boundaries are separate blockers.
- Overlap/touching between active, geographically active boundaries is reported as a warning when the two zones are not both currently available for the requested service.
- An overlap is a blocking issue for both zones when both currently have effective availability for the requested service. This reflects GEO-03 booking-time ambiguity behavior.
- `enabledDriverCoverageCount` counts enabled coverage records for the requested service; it does not claim that those drivers are currently online, verified, KYC eligible, vehicle eligible, or dispatch eligible.
- `dispatchCoverageConfigured` only indicates that at least one enabled coverage record exists. Driver eligibility remains governed by dispatch rules.

## Geometry behavior

- Only valid Polygon/MultiPolygon boundaries are compared.
- Overlap detection includes shared edges/touching boundaries and polygon area overlap.
- Polygon holes are respected for containment checks.
- The readiness endpoint is a diagnostic preflight. GEO-03 booking-time resolution remains authoritative and independently fails closed on multiple matching zones.

## Environment

No new environment variable or package is introduced in GEO-04. The Maps browser key and backend Maps provider keys remain as documented in GEO-02/GEO-03. A regression test now compares every runtime key in `src/config/env.js` against backend `.env.example` so future configuration changes cannot silently omit required entries.

## Validation and rollout

Automated tests cover overlapping, touching, disjoint, and hole-contained polygons; active overlap blocking; overlap warnings when one zone is not currently available; missing/invalid boundaries; inactive geography/availability; pricing absence; and driver coverage reporting.

Before production readiness is claimed:

1. Backend CI passes on the final PR head, including unit tests, OpenAPI/route parity, Prisma validation/generation, and PostgreSQL checks.
2. Admin frontend consumes the endpoint and clearly distinguishes booking blockers from dispatch-coverage configuration.
3. Test the endpoint against staging data and reconcile its results with the Admin boundary editor, service availability settings, pricing configuration, and driver coverage assignments.
4. Verify overlap results against representative mapped zones, including nested holes and shared boundaries.
5. Do not activate or enable any additional zone solely because the audit returns `bookingReady: true`; operational capacity, hub/partner workflows, and dispatch eligibility still require review.

## Known limitations

- Pairwise overlap analysis is O(n²) in the number of candidate active zones. Each boundary is validated once per report before pair checks. Measure latency and zone counts before scaling to large zone inventories.
- The audit does not yet check whether enabled coverage records belong to currently eligible drivers or whether vehicles are available.
- The audit does not infer or normalize a booking address from Google components. GEO-03 resolves canonical zone relations through boundary containment.
- It does not test every point in the boundary or prove that all of the polygon is geographically correct. Admin must still review boundary quality.
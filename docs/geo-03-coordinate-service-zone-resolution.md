# GEO-03 — Coordinate-to-service-zone resolution

**Status:** Backend PR #138 and customer frontend PR #60 are merged. Operational staging acceptance and controlled rollout remain outstanding.  
**Scope:** Backend point-in-polygon resolution and parcel booking-time revalidation.  
**Spatial engine:** Application-level WGS84 geometry evaluation using the existing validated GeoJSON implementation. No PostGIS extension or new package is introduced.

## Contract

1. Pickup and destination coordinates are resolved independently as `[longitude, latitude]` against active Nigerian service zones.
2. A candidate zone must have an active state and country, an active zone record, currently effective `PARCEL_DELIVERY` availability, and a stored Polygon/MultiPolygon boundary.
3. Zones without a boundary are not serviceable by coordinate resolution.
4. Polygon exterior edges are inclusive. A point in a hole or on a hole edge is outside the service zone.
5. If a coordinate matches more than one zone (including shared edges), resolution returns `SERVICE_ZONE_AMBIGUOUS`. The server never chooses by result ordering or nearest distance.
6. An invalid stored boundary on an otherwise eligible zone fails closed with `SERVICE_ZONE_BOUNDARY_INVALID`; an administrator must correct it.
7. No match returns `SERVICE_ZONE_NOT_FOUND`.
8. Existing `pickupServiceZoneId` and `destinationServiceZoneId` request properties are optional compatibility hints only. If supplied, each must equal the independently resolved zone or the request fails with `SERVICE_ZONE_RESOLUTION_MISMATCH`.
9. The server persists the resolved zone IDs and uses the resolved pickup zone for pricing-rule selection. The client cannot select authoritative zones.

## Geography normalization decision

This phase does not infer state/LGA from Google free-text components. Polygon containment selects the operational `ServiceZone`, whose canonical `state` and optional `lga` relations are already linked to seeded reference records. This avoids provider-specific aliases and ambiguous text matching. The booking persists canonical service-zone IDs; state/LGA remain available through the zone relations for later route classification and operational read models.

## Runtime and environment configuration

- No new backend environment variable is required. The backend uses the existing `MAPS_PROVIDER` and `GOOGLE_MAPS_API_KEY` configuration for Google Places/geocoding workflows; point-in-polygon evaluation itself does not call Google.
- The backend `.env.example` already documents `MAPS_PROVIDER` and `GOOGLE_MAPS_API_KEY`.
- The Admin map editor requires the separate public frontend variable `VITE_GOOGLE_MAPS_BROWSER_API_KEY`, now documented in the frontend `.env.example` on frontend PR #59. It must be restricted by HTTP referrer and must never reuse the backend server key.

## Rollout safety

This changes parcel booking creation from trusting supplied zone IDs to requiring valid coordinate coverage. Existing active zones without boundaries will no longer accept new parcel bookings after this backend change is deployed. Do not deploy/enable the phase until the intended launch zones have validated boundaries, effective parcel availability, and an operationally reviewed coverage plan. This is deliberate fail-closed behavior, not a silent fallback to client-supplied IDs.

No zone activation, boundary data write, or live deployment was included in the implementation PRs.

## Tests and acceptance

**CI evidence:** backend PR #138 run [42638103426](https://github.com/Olexxee/Logistic-Hub/actions/runs/42638103426) passed. The workflow completed Prisma validation/client generation, OpenAPI/route validation, foundation integrity validation, disposable PostgreSQL migration/history/schema-drift checks, and `npm test` (675 passed, 0 failed, 1 skipped by the explicit PostgreSQL integrity-test gate).

Automated coverage added for Polygon/MultiPolygon containment, exterior edges, holes, missing boundaries, invalid stored geometry, overlapping-zone ambiguity, optional legacy hints, mismatch rejection, independently resolved pickup/destination, and pricing selection from the resolved pickup zone.

Required before operational rollout:

- Backend CI passes on the latest PR head, including `npm test`, `npm run api:validate`, Prisma generation/schema validation and PostgreSQL integrity checks.
- Configure a disposable zone boundary through the Admin editor and verify saved geometry is read by the resolver.
- Verify a point inside the zone resolves; outside and hole points fail; shared edges/overlaps fail as ambiguous.
- Verify current availability windows are respected and that disabling availability immediately removes a zone from resolution.
- Run staging booking tests with a valid boundary and a mismatched client hint.
- Confirm the customer frontend handles the new conflict codes and does not present a client-selected zone as authoritative.

## Known limits / follow-up

- The first implementation evaluates candidate boundaries in application memory and validates each candidate geometry once per booking request. This is appropriate as a controlled initial implementation, not a claim of unlimited spatial-query scale. Record zone count, boundary vertex count and resolution latency in staging before broad rollout.
- Cross-record overlaps are detected at request time through multiple matches rather than prevented during Admin boundary updates. A future Admin-side overlap audit should identify conflicting zone pairs before activation.
- No nearest-zone fallback, geocoding fallback, or automatic state/LGA guess is allowed.
- A later scale review may introduce bounding-box prefiltering or PostGIS, but only with hosted-provider extension support, migration/rollback design and measured query-volume evidence.
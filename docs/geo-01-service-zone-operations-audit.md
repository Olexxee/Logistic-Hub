# GEO-01 — Service-Zone Operations and Boundary Audit

**Status:** Source audit complete; implementation decisions gated on GEO-02 design review  
**Audit date:** 2026-11-09  
**Scope:** Read-only audit of the Logistic Hub backend, Admin frontend and previously completed hosted-database diagnostic  
**Change policy:** No application code, schema, hosted data, migrations or deployment was changed during this audit.

## 1. Executive decision

The existing geography and service-zone foundation should be retained. Multiple operational zones per LGA are supported by the current data model, state activation and per-service availability administration exist, and the backend already has an Admin driver-coverage mutation.

The blocking gap is boundary management and coordinate-to-zone resolution:

- `ServiceZone.boundaryGeoJson` is nullable JSON storage.
- The backend accepts a generic JSON object for this field.
- The Admin frontend create/edit form does not expose the field.
- No GeoJSON Polygon/MultiPolygon validation or map-based boundary editor was found in the inspected frontend/backend paths.
- The hosted database contains one service zone and its boundary is null.
- The database has no PostGIS extension, and there are no populated boundaries to validate or query.

Therefore, the current system must not claim polygon-based serviceability. Do not add PostGIS, import polygon datasets, or change the schema as part of GEO-01.

## 2. Verified current capabilities

### 2.1 Geography administration

**Backend routes:** `src/modules/geography/geography.admin.routes.js`  
**Service:** `src/modules/geography/geography.admin.service.js`  
**Validators:** `src/modules/geography/geography.admin.validators.js`  
**Frontend:** `src/features/geography/pages/GeographyPage.tsx`, `src/features/geography/api/geography.api.ts`

Confirmed:
- Admin-only country, state and LGA list/create/update operations exist.
- Admin-only country and state activation/deactivation endpoints exist.
- The Geography Admin page exposes country/state status controls.
- A state cannot be activated under an inactive country.
- A state cannot be deactivated while active service zones remain.
- A country cannot be deactivated while active child states remain.
- Geography mutations are performed in serializable transactions with bounded retry and operational audit events.

**Finding:** State activation is an implemented Admin workflow. The hosted database diagnostic is a snapshot, not a claim that all states should be activated. Only activate a state when its operational coverage is ready.

### 2.2 Multiple zones per LGA

**Backend:** `prisma/schema.prisma`, `src/modules/geography/service-zones.admin.service.js`  
**Frontend:** `src/features/service-areas/pages/ServiceAreasPage.tsx`

The schema permits multiple service-zone records to reference the same LGA. Zone code uniqueness is scoped to the state; the LGA relation is optional. The Admin form selects a state and optional LGA and does not enforce one zone per LGA.

**Finding:** The requirement for multiple operational zones within one LGA is compatible with the existing model. No schema change is justified for that requirement.

An LGA is an administrative geography. A service zone is an operational coverage area. A zone may be LGA-scoped or state-wide; multiple service zones may exist within the same LGA.

### 2.3 Service-zone administration

**Backend routes:** `src/modules/geography/service-zones.routes.js`  
**Admin service:** `src/modules/geography/service-zones.admin.service.js`  
**Admin validator:** `src/modules/geography/service-zones.admin.validators.js`  
**Frontend API:** `src/features/service-areas/api/service-areas.api.ts`  
**Frontend page:** `src/features/service-areas/pages/ServiceAreasPage.tsx`

Confirmed:
- Admin-only create, update, activate/deactivate and list routes exist.
- Zone creation requires an active state and active country.
- An optional LGA must belong to the selected state.
- Active hubs block certain zone deactivation and LGA reassignment operations.
- Service-zone mutations emit operational audit events.
- The Admin page supports zone creation/editing, status changes and availability configuration.

**Boundary gap:**
- Backend create/update validators accept `boundaryGeoJson` as a generic nullable JSON record.
- The backend does not validate that the object is a valid GeoJSON Feature, Polygon or MultiPolygon, nor does the current contract establish ring closure, coordinate order, finite coordinate values, geographic bounds, geometry validity or supported geometry types.
- The frontend `ServiceZoneInput` and `ServiceZoneUpdate` types omit `boundaryGeoJson`.
- The zone form submits only state, LGA, code and name. There is no map editor or boundary upload/draw workflow in the inspected page.
- The admin list response includes the stored boundary value, but the page does not expose it for editing or visualization.

**Finding:** Boundary storage is present; production-ready boundary authoring and validation are not established. The user's statement that boundaries have not yet been activated is consistent with the code and hosted data evidence.

### 2.4 Service availability

The existing model and Admin workflow provide independent availability per service zone and service type, with:
- `isEnabled`
- optional `startsAt`
- optional `endsAt`
- optional service configuration

The Admin Service Areas page exposes the service-type selector, enabled toggle and effective window. The backend rejects enabling availability under inactive parent geography or an inactive zone. Parcel availability changes are guarded when active hubs depend on the zone.

The driver readiness service also requires enabled, currently effective availability for the relevant driver coverage.

**Finding:** Retain this as the authoritative service-availability control. A zone being active must not imply that every service is available. An enabled service must still be checked at booking and matching time.

**Hosted database snapshot:** `service_availability` contained zero rows at the time of the read-only diagnostic. This is an operational configuration gap, not proof that the availability feature is missing.

### 2.5 Driver coverage

**Backend route:** `PUT /api/v1/drivers/admin/coverage` (mounted from `src/modules/drivers/drivers.routes.js`)  
**Schema:** `src/modules/drivers/drivers.schemas.js`  
**Service:** `src/modules/drivers/drivers.service.js`

The Admin-only mutation accepts:
- `driverProfileId`
- `serviceZoneId`
- `serviceType`
- `isEnabled`

Enabling coverage requires an active zone, active state and country, and matching currently effective service availability. Driver availability checks also require a verified active vehicle and eligible enabled coverage.

The unified Admin driver/vehicle workspace has driver and vehicle management routes. However, the inspected frontend source did not establish a complete driver-to-zone coverage assignment workflow or a frontend API call to the coverage mutation. Treat the Admin coverage UI as **unverified / requiring a focused frontend route-and-component check**, not as a confirmed delivered workflow.

**Finding:** Backend coverage control exists. Coverage must remain Admin-managed and auditable; drivers must not grant themselves service-zone coverage.

**Hosted database snapshot:** `driver_coverage` contained zero rows. This means no explicit coverage assignments existed in that snapshot. It does not establish that no driver accounts exist.

## 3. Hosted database evidence

The previously completed read-only diagnostic reported:

| Dataset | Snapshot |
|---|---:|
| Countries | 1 total; 1 active |
| State-level units | 37 total; 1 active |
| LGAs / FCT Area Councils | 774 across 37 state-level units |
| Service zones | 1 total; 1 active |
| Service availability | 0 rows |
| Driver coverage | 0 rows |
| Service-zone boundaries | 1 zone with null boundary |
| PostGIS / postgis_topology | Not installed |
| Orphan LGAs / zones | 0 |

The only active state in that snapshot was Osun. The only zone was Campus Zone (`OS-01`), associated with Osun / Ife South. Its `boundaryGeoJson` was null.

These are time-specific database observations. Recheck before operational activation; do not treat the snapshot as a permanent configuration guarantee.

## 4. Google Maps integration boundary

The existing backend Maps provider returns normalized place information including formatted address, coordinates, Place ID, country code and address components.

That provider response does not itself resolve:
- the Logistic Hub `State` record ID,
- the Logistic Hub `LGA` record ID,
- an operational `ServiceZone` ID, or
- whether a requested service is currently available in that zone.

Google Places address components are provider data, not foreign keys into Logistic Hub's seeded geography. Nigerian state/LGA names and aliases require deterministic normalization and a controlled resolution policy. A missing or ambiguous LGA component must not be guessed from a free-text address.

A selected Google place is not proof of serviceability. The backend must remain authoritative.

## 5. Recommended operating model

Keep these controls distinct:

1. **Reference geography:** country → state → LGA. Admin maintains and activates these records.
2. **Operational service zones:** one or more zones can be associated with a state and optionally an LGA. A zone may eventually have a validated geographic boundary.
3. **Service availability:** independently enables a service type in a zone for an effective time window.
4. **Driver coverage:** Admin assigns a driver to a zone and service type. The driver must separately meet verification, vehicle, capability and availability requirements.
5. **Booking serviceability:** the backend resolves pickup and destination coordinates to authoritative geography and a service zone, then checks service availability and the relevant operational coverage rules.

A customer must not submit an authoritative service-zone ID and have the backend trust it merely because the ID is active. The backend must verify the relationship between the selected coordinates and the resolved operational zone.

When resolution is missing, ambiguous, outside all active zones, or has no effective availability, fail closed with a specific actionable response. Do not silently select the nearest zone or default a route to local delivery.

## 6. GEO-02 design requirements

GEO-02 should design and implement the boundary authoring and validation contract before customer-side coordinate resolution.

### Boundary data contract

- Support only explicitly documented GeoJSON geometry types required by the product; likely Polygon and MultiPolygon.
- Validate the complete geometry structure, coordinate nesting, finite longitude/latitude values, geographic ranges, minimum ring sizes and closed linear rings.
- Reject unsupported geometry types, malformed coordinates and invalid empty geometries.
- Establish a policy for self-intersection, holes, overlapping zones and boundary-edge points.
- Define whether a zone can be saved as a draft without a boundary and whether it can become serviceable without one.
- Preserve audit before/after snapshots and require a reason for high-impact boundary changes where appropriate.
- Ensure the API returns a canonical validated geometry representation.

### Admin experience

- Add an interactive map boundary editor to the Service Areas workflow.
- Allow an Admin to draw and edit polygons, review the selected state/LGA context, and preview the saved boundary.
- Do not make the map's visual state the authority; the backend validates every submitted geometry.
- Display explicit boundary status: missing, draft/unvalidated, valid, or invalid.
- Prevent activation for coordinate-resolved service until the required boundary and validation state exist.
- Keep service availability and boundary validity visible as separate controls.

### Spatial implementation decision

Do not install PostGIS solely because a `boundaryGeoJson` JSONB field exists. GEO-02 must compare:
- application-level geometry validation and point-in-polygon evaluation using a maintained geospatial library, versus
- PostGIS geometry/geography columns, spatial indexes and database-side containment queries.

Choose based on expected zone count, query volume, geometry complexity, transactional consistency and operational support. If PostGIS is selected, document the migration, extension availability on the hosted Prisma database, deployment ordering, rollback and index strategy before applying any change.

### Coverage administration

Perform a focused frontend audit for the Admin driver-to-zone assignment workflow. If missing, implement a dedicated Admin coverage manager that:
- lists eligible drivers and their verified vehicle/capability status,
- assigns or disables coverage by service zone and service type,
- displays the zone's active state and effective availability,
- explains why an assignment cannot be enabled,
- records the responsible Admin and audit history.

Do not duplicate or weaken the backend eligibility rules in the browser.

## 7. GEO-03 location-resolution contract

After GEO-02 provides valid boundaries, GEO-03 should implement a backend-owned resolution operation:

1. Accept a canonical selected place identifier and/or validated coordinates under the existing Maps contract.
2. Resolve the Nigerian state and LGA against seeded reference data using normalized provider address components and an explicit alias strategy.
3. Verify coordinate containment in the resolved operational service zone using the selected spatial implementation.
4. Detect no-match and ambiguous/multiple-match outcomes; never guess or choose the nearest zone as a fallback.
5. Check current service availability for the requested service type.
6. Return canonical state, LGA and service-zone identifiers plus a stable resolution outcome.
7. Revalidate at booking creation; never trust a stale client-side resolution result as authorization.

Pickup and destination must be resolved independently. Local/inter-state classification must use authoritative resolved state metadata, not a frontend comparison of address strings.

## 8. Explicit non-goals and safety gates

GEO-01 does not:
- install PostGIS,
- add migrations or schema fields,
- source or import polygon datasets,
- activate more states or zones,
- create service-availability or driver-coverage records,
- change booking or matching behavior,
- enable payment, dispatch or production operations.

No live database mutation or deployment is authorized by this audit.

## 9. Acceptance criteria and sequence

| Phase | Acceptance gate |
|---|---|
| GEO-01 — Audit | Complete source/database evidence; document actual Admin capabilities and gaps. **Complete.** |
| GEO-02 — Boundaries | Validated geometry contract, Admin map editor, lifecycle/audit rules, tests and reviewed spatial implementation choice. |
| GEO-03 — Resolution | Backend state/LGA/zone resolution, availability checks, ambiguity handling, booking revalidation and regression tests. |
| GEO-04 — Operational rollout | Admin-configured boundaries, availability and driver coverage; controlled staging acceptance before any production expansion. |

GEO-02 must not begin with a schema migration or PostGIS installation before the geometry contract and spatial decision are reviewed. GEO-03 must not ship a coordinate resolver that guesses serviceability.

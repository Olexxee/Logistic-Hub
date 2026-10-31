# Phase 3B — Geography and service-coverage administration

**Status:** Complete. Core implementation merged in PR #50; parent-geography transaction-integrity hardening merged in PR #51.  
**Baseline:** `main` after merged Phase 3B PR #50.  
**Scope:** Country → state → LGA hierarchy, service-zone lifecycle, per-service availability and operational hub consistency.

## Acceptance criteria

### 3B.1 Geography hierarchy
- Country, state and LGA administration remains ADMIN-only.
- Child records can only be created beneath active parent geography.
- Parent geography cannot be deactivated while active child coverage remains.
- Parent geography activation/deactivation and child creation use serializable transactions with bounded retry for Prisma serialization conflicts.
- Geography references cannot be silently re-parented through update payloads.
- Referenced LGAs cannot be deleted.

### 3B.2 Service-zone lifecycle
- A zone can only be created beneath an active state/country.
- An inactive parent prevents zone activation and new hub registration.
- LGA assignment must belong to the same state as the zone.
- Changing the LGA assignment while active hubs remain is rejected.
- Deactivating a zone while active hubs remain is rejected.

### 3B.3 Service availability
- Availability windows must be valid and ordered.
- An active hub requires its zone's parcel-delivery availability to be effective now.
- Disabling parcel delivery or moving its effective window outside the current time is rejected while active hubs remain.
- Other service types remain independently configurable.
- Availability state/window and boundary changes are included in audit snapshots; arbitrary availability config is not copied into audit JSON, but config changes are flagged in metadata to avoid leaking unvalidated secrets.

### 3B.4 Hub operational consistency
- Hub creation, update and status changes read and validate coverage within the same database transaction as the write.
- Hub activation requires active country/state/zone and effective parcel-delivery availability.
- An active hub cannot have operator verification downgraded until the hub is suspended.
- A hub cannot be permanently closed while it still has non-terminal delivery legs, received/exception intakes, pending custody handovers or unresolved operational cases. Emergency suspension remains available to stop new operations immediately.
- Active hub operational details remain validated on update.
- Coverage lifecycle mutations and hub activation use serializable transactions with bounded retry for Prisma serialization conflicts, preventing concurrent write-skew between disabling coverage and activating a hub.

### 3B.5 Authorization and regression coverage
- Geography and service-zone administration remain ADMIN-only.
- Unit tests cover coverage/hub invariants and failure paths.
- Existing PostgreSQL integration coverage remains in place for geography, availability and public discovery.

## Implemented in this workstream

- Block service-zone deactivation while active hubs remain.
- Block LGA reassignment while active hubs remain.
- Block parcel-delivery disablement or future/expired availability windows while active hubs remain.
- Perform hub create/update/activation checks transactionally.
- Use serializable transactions with up to two retries for Prisma `P2034` conflicts across service-zone lifecycle and hub mutations.
- Apply the same serializable transaction/retry policy to country, state and LGA administration so parent deactivation cannot race child creation.
- Prevent active hub operator verification from being downgraded.
- Expand audit snapshots to include service-zone boundary GeoJSON and hub coordinates; record only a configChanged flag for arbitrary availability config.
- Add admin route authorization and service-level invariant tests.

## Explicitly out of scope / decisions still required

- **Geospatial containment:** current booking and discovery logic filters by configured country/state/LGA/service-zone IDs; it does not perform point-in-polygon checks against `boundaryGeoJson`. Do not imply a GeoJSON boundary is enforced as a geofence. A separate decision is needed on geometry type, coordinate reference system (GeoJSON WGS84), boundary semantics and whether pickup/destination points must be inside polygons.
- **Bulk geography import:** no authoritative Nigeria 36-state/FCT and 774-LGA source dataset is bundled or imported by this change. Do not seed an unverified dataset.
- **Admin pagination/search:** current admin list endpoints return complete result sets. Introduce pagination only with a coordinated API contract and client rollout.
- **Operational impact policy:** this change requires active hubs to be suspended before disabling their parcel coverage. It does not cancel or rewrite existing bookings/delivery legs; in-flight work must continue using its persisted service-zone references.
- No Prisma schema changes, migrations, production data edits, payment activation or role-grant changes are included.

## Closeout verification

- [x] Phase 3B core implementation merged in PR #50.
- [x] Geography, service-zone and hub lifecycle invariants have unit/integration coverage.
- [x] Final parent-geography serializable transaction hardening merged in PR #51.
- [x] Full API and PostgreSQL integrity suite passed on the Phase 3B closeout workflow.

## Deferred by explicit scope boundary

- Geospatial containment, authoritative geography import and admin pagination/search remain separate follow-up work. They are not silently treated as delivered by this phase. Pagination/search should be coordinated with the admin frontend contract; a geography import must use a verified authoritative source; geofence enforcement requires an agreed pickup/destination containment policy.

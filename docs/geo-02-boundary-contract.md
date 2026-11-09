# GEO-02A — Service-zone boundary contract and validation

## Scope

This increment establishes a strict backend contract for service-zone boundary writes. It does not yet provide a map drawing interface, coordinate-to-zone resolution, automatic activation, PostGIS, polygon imports, or changes to booking eligibility.

## Canonical input

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [3.35, 6.50],
      [3.36, 6.50],
      [3.36, 6.51],
      [3.35, 6.50]
    ]
  ]
}
```

- Accept only GeoJSON Geometry objects of type `Polygon` or `MultiPolygon`; reject Feature and FeatureCollection wrappers.
- Coordinate order is longitude, latitude (WGS 84 / CRS84 convention); each position contains exactly two finite numbers.
- Longitude is in [-180, 180], latitude in [-90, 90].
- Every linear ring has at least four positions and is explicitly closed (first and last positions identical).
- Reject adjacent duplicate points, zero-area rings, and self-intersections.
- Polygon holes must be inside the exterior ring and may not cross or overlap it or another hole.
- Components in a MultiPolygon may not overlap or touch.
- Enforce a total vertex ceiling to bound validation cost and request size.

## Boundary lifecycle for this increment

- `null` / omitted: no boundary supplied; existing behavior remains unchanged.
- A non-null boundary must pass structural and planar topology validation before create/update persists it.
- Validation failure returns the normal `VALIDATION_ERROR` response; invalid geometry is never stored.
- Existing stored JSON is not retroactively certified by this change.
- This increment deliberately does not claim that a zone is operationally serviceable merely because its boundary is valid. Service availability, parent geography, hub constraints, driver coverage and future coordinate resolution remain independent gates.

## Geometry semantics and limitations

Validation uses planar segment/ring predicates over longitude/latitude coordinates. It catches malformed rings, zero-area rings, self-intersections, invalid holes, and overlapping/touching MultiPolygon components. It does not calculate geodesic area, infer missing vertices, snap coordinates, repair polygons, or validate overlaps between separate service zones. Zone-to-zone overlap policy and boundary-edge assignment semantics must be decided before GEO-03 resolution.

## Explicitly deferred

1. Admin map drawing/editing and boundary preview.
2. Persisted boundary review states and reviewer workflow.
3. Zone-to-zone overlap governance.
4. Coordinate containment and ambiguous/no-match outcomes.
5. Driver coverage assignment UI.
6. PostGIS evaluation and any provider extension enablement.
7. Activating the seeded Campus Zone for coordinate-based serviceability.

## Verification

The GEO-02A test suite covers valid Polygon/MultiPolygon inputs and malformed coordinates, ring closure, insufficient positions, duplicate points, self-intersections, invalid holes, component overlap/touch, and vertex-limit enforcement.

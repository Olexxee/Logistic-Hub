import {
  classifyPointInValidatedServiceZoneBoundary,
  validateServiceZoneBoundary,
} from "./geojson-boundary.js";

/**
 * Validate active-zone boundaries once per booking request. Zones without a
 * boundary are intentionally not serviceable by coordinate resolution.
 */
export function prepareServiceZoneBoundaries(zones) {
  const prepared = [];
  for (const zone of zones) {
    if (zone.boundaryGeoJson == null) continue;
    const validation = validateServiceZoneBoundary(zone.boundaryGeoJson);
    if (!validation.valid) return { status: "invalid-boundary", zoneId: zone.id };
    prepared.push({ zone, boundaryGeoJson: zone.boundaryGeoJson });
  }
  return { status: "ready", zones: prepared };
}

/**
 * Resolve a WGS84 coordinate against prepared active, currently serviceable
 * zones. Edges are inclusive; multiple matches are never resolved by ordering.
 */
export function resolveServiceZoneForPoint(prepared, coordinates) {
  if (prepared.status !== "ready") return prepared;
  const point = [coordinates.longitude, coordinates.latitude];
  const matches = [];

  for (const candidate of prepared.zones) {
    const classification = classifyPointInValidatedServiceZoneBoundary(candidate.boundaryGeoJson, point);
    if (classification === "inside" || classification === "boundary") {
      matches.push({ zone: candidate.zone, classification });
    }
  }

  if (matches.length === 0) return { status: "not-found" };
  if (matches.length > 1) {
    return { status: "ambiguous", zoneIds: matches.map(({ zone }) => zone.id) };
  }
  return { status: "resolved", zone: matches[0].zone, classification: matches[0].classification };
}

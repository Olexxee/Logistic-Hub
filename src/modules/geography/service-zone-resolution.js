import {
  classifyPointInValidatedServiceZoneBoundary,
  validateServiceZoneBoundary,
} from "./geojson-boundary.js";

/**
 * Resolve a WGS84 coordinate against active, currently serviceable zone records.
 * Boundaries are inclusive; if more than one zone contains/touches the point,
 * the result is ambiguous and must not be resolved by arbitrary ordering.
 */
export function resolveServiceZoneForPoint(zones, coordinates) {
  const point = [coordinates.longitude, coordinates.latitude];
  const matches = [];

  for (const zone of zones) {
    const validation = validateServiceZoneBoundary(zone.boundaryGeoJson);
    if (!validation.valid) {
      return { status: "invalid-boundary", zoneId: zone.id };
    }
    const classification = classifyPointInValidatedServiceZoneBoundary(zone.boundaryGeoJson, point);
    if (classification === "inside" || classification === "boundary") {
      matches.push({ zone, classification });
    }
  }

  if (matches.length === 0) return { status: "not-found" };
  if (matches.length > 1) {
    return { status: "ambiguous", zoneIds: matches.map(({ zone }) => zone.id) };
  }
  return { status: "resolved", zone: matches[0].zone, classification: matches[0].classification };
}

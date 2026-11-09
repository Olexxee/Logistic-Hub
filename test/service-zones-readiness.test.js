import test from "node:test";
import assert from "node:assert/strict";
import { createServiceZonesAdminService } from "../src/modules/geography/service-zones.admin.service.js";
import { serviceZoneBoundariesOverlap } from "../src/modules/geography/geojson-boundary.js";

const now = new Date("2026-11-09T12:00:00.000Z");
const squareA = { type: "Polygon", coordinates: [[[3, 6], [4, 6], [4, 7], [3, 7], [3, 6]]] };
const squareOverlap = { type: "Polygon", coordinates: [[[3.5, 6.5], [4.5, 6.5], [4.5, 7.5], [3.5, 7.5], [3.5, 6.5]]] };
const squareTouch = { type: "Polygon", coordinates: [[[4, 6], [5, 6], [5, 7], [4, 7], [4, 6]]] };
const squareAway = { type: "Polygon", coordinates: [[[8, 6], [9, 6], [9, 7], [8, 7], [8, 6]]] };

test("boundary overlap detection identifies area overlap and shared edges", () => {
  assert.equal(serviceZoneBoundariesOverlap(squareA, squareOverlap), true);
  assert.equal(serviceZoneBoundariesOverlap(squareA, squareTouch), true);
  assert.equal(serviceZoneBoundariesOverlap(squareA, squareAway), false);
});

test("boundary overlap detection respects a containing polygon hole", () => {
  const withHole = { type: "Polygon", coordinates: [
    [[3, 6], [7, 6], [7, 10], [3, 10], [3, 6]],
    [[4, 7], [6, 7], [6, 9], [4, 9], [4, 7]],
  ] };
  const insideHole = { type: "Polygon", coordinates: [[[4.5, 7.5], [5.5, 7.5], [5.5, 8.5], [4.5, 8.5], [4.5, 7.5]]] };
  assert.equal(serviceZoneBoundariesOverlap(withHole, insideHole), false);
});

function zone(id, options = {}) {
  return {
    id, code: id.toUpperCase(), name: id, isActive: options.isActive ?? true,
    boundaryGeoJson: options.boundaryGeoJson === undefined ? squareA : options.boundaryGeoJson,
    state: { id: "state-1", code: "NG-LA", name: "Lagos", isActive: options.geographyActive ?? true, country: { isActive: true } },
    lga: { id: "lga-1", code: "IKEJA", name: "Ikeja" },
    availability: options.availability === false ? [] : [{ serviceType: "PARCEL_DELIVERY", isEnabled: true, startsAt: null, endsAt: null }],
    coverage: options.coverage === false ? [] : [{ id: "coverage-1" }],
    pricingRules: options.pricing === false ? [] : [{ id: "pricing-1" }],
  };
}

function serviceFor(zones) {
  return createServiceZonesAdminService({
    clock: () => now,
    prismaClient: { serviceZone: { findMany: async () => zones } },
  });
}

test("readiness marks active overlapping parcel zones blocked for the current service", async () => {
  const result = await serviceFor([zone("zone-a"), zone("zone-b", { boundaryGeoJson: squareOverlap })]).listReadiness();
  assert.equal(result.summary.totalZones, 2);
  assert.equal(result.summary.activeBoundaryOverlapCount, 1);
  assert.equal(result.summary.bookingReadyZones, 0);
  assert.equal(result.zones.every(item => item.blockers.includes("ACTIVE_ZONE_BOUNDARY_OVERLAP")), true);
  assert.equal(result.overlapWarnings[0].severity, "BLOCKING");
  assert.equal(result.overlapWarnings[0].affectsCurrentService, true);
});

test("readiness treats overlap as a warning when one zone has no effective service availability", async () => {
  const result = await serviceFor([zone("zone-a"), zone("zone-b", { boundaryGeoJson: squareOverlap, availability: false })]).listReadiness();
  assert.equal(result.overlapWarnings[0].severity, "WARNING");
  assert.equal(result.overlapWarnings[0].affectsCurrentService, false);
  assert.equal(result.zones[0].bookingReady, true);
});

test("readiness reports missing boundaries, availability, pricing and driver coverage separately", async () => {
  const result = await serviceFor([
    zone("ready-no-coverage", { coverage: false }),
    zone("missing-boundary", { boundaryGeoJson: null }),
    zone("missing-pricing", { pricing: false }),
    zone("inactive-availability", { availability: false }),
    zone("inactive-geography", { geographyActive: false }),
  ]).listReadiness();
  const byId = Object.fromEntries(result.zones.map(item => [item.id, item]));
  assert.equal(byId["ready-no-coverage"].bookingReady, true);
  assert.equal(byId["ready-no-coverage"].dispatchCoverageConfigured, false);
  assert.equal(byId["missing-boundary"].blockers.includes("BOUNDARY_MISSING"), true);
  assert.equal(byId["missing-pricing"].blockers.includes("PRICING_UNAVAILABLE"), true);
  assert.equal(byId["inactive-availability"].blockers.includes("SERVICE_AVAILABILITY_INACTIVE"), true);
  assert.equal(byId["inactive-geography"].blockers.includes("GEOGRAPHY_INACTIVE"), true);
  assert.equal(result.summary.zonesWithoutDispatchCoverage, 1);
});

test("readiness reports invalid stored boundaries without crashing the full audit", async () => {
  const result = await serviceFor([zone("bad-boundary", { boundaryGeoJson: { type: "Polygon", coordinates: [] } })]).listReadiness();
  assert.equal(result.zones[0].boundary.status, "INVALID");
  assert.equal(result.zones[0].blockers.includes("BOUNDARY_INVALID"), true);
  assert.equal(result.overlapWarnings.length, 0);
});
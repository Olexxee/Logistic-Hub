import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROUTE_WEIGHT_BANDS, findPlatformRouteWeightBand, isCanonicalPlatformRouteWeightBand } from "./platform-route-weight-bands.js";

test("defines seven contiguous bands from 1 g through 30 kg", () => {
  assert.equal(PLATFORM_ROUTE_WEIGHT_BANDS.length, 7);
  assert.equal(PLATFORM_ROUTE_WEIGHT_BANDS[0].minWeightGrams, 1);
  assert.equal(PLATFORM_ROUTE_WEIGHT_BANDS.at(-1).maxWeightGrams, 30000);
  for (let index = 1; index < PLATFORM_ROUTE_WEIGHT_BANDS.length; index += 1) {
    assert.equal(PLATFORM_ROUTE_WEIGHT_BANDS[index].minWeightGrams, PLATFORM_ROUTE_WEIGHT_BANDS[index - 1].maxWeightGrams + 1);
  }
});

test("accepts only exact canonical band boundaries", () => {
  for (const band of PLATFORM_ROUTE_WEIGHT_BANDS) {
    assert.equal(isCanonicalPlatformRouteWeightBand(band.minWeightGrams, band.maxWeightGrams), true);
    assert.equal(findPlatformRouteWeightBand(band.minWeightGrams, band.maxWeightGrams)?.id, band.id);
  }
});

test("rejects gaps, overlaps, partial bands, zero weight and freight above 30 kg", () => {
  for (const [min, max] of [[0,1000],[1,999],[1000,3000],[1001,5000],[30001,40000],[20001,null],[30001,30001]]) {
    assert.equal(isCanonicalPlatformRouteWeightBand(min, max), false, `Expected ${min}–${max} g to be rejected`);
  }
});

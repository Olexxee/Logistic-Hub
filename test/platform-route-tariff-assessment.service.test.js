import test from "node:test";
import assert from "node:assert/strict";
import { assessPlatformRouteTariffs } from "../src/modules/platform-route-pricing/platform-route-tariff-assessment.service.js";

const now = new Date("2026-11-10T12:00:00.000Z");
const routeSnapshot = { routeMode: "LOCAL_DIRECT", routePlanVersion: 1 };
const packages = [{ packageCategory: "box", weightGrams: 1200, lengthMm: 200, widthMm: 100, heightMm: 80 }];

function transaction({ availability = { id: "availability_1" }, rates = [] } = {}) {
  const calls = { availability: 0, rates: 0 };
  return {
    calls,
    tx: {
      platformRouteAvailability: { findFirst: async () => { calls.availability += 1; return availability; } },
      platformRouteRate: { findMany: async () => { calls.rates += 1; return rates; } },
    },
  };
}

const rate = (overrides = {}) => ({
  id: "rate_1", version: 3, parcelCategory: "box", currency: "NGN",
  minWeightGrams: 500, maxWeightGrams: 2000,
  maxLengthMm: 300, maxWidthMm: 200, maxHeightMm: 100,
  customerTransportChargeMinor: 2500n, platformChargeMinor: 300n,
  driverPayoutMinor: 1800n, estimatedTransitMinutes: 45,
  ...overrides,
});

test("shared assessment returns a customer quote and a separate internal driver payout snapshot", async () => {
  const { tx, calls } = transaction({ rates: [rate()] });
  const result = await assessPlatformRouteTariffs({
    tx, originServiceZoneId: "zone_a", destinationServiceZoneId: "zone_b",
    packages, currency: "NGN", now, routeSnapshot, expiresAt: new Date("2026-11-10T13:00:00Z"),
  });
  assert.equal(result.status, "QUOTED");
  assert.equal(result.options[0].customerCharge, 2800n);
  assert.equal(result.options[0].driverPayout, 1800n);
  assert.equal(result.options[0].rateSnapshot[0].rateVersion, 3);
  assert.equal(calls.availability, 1);
  assert.equal(calls.rates, 1);
});

test("missing package weight returns measurement required without querying route tariffs", async () => {
  const { tx, calls } = transaction();
  const result = await assessPlatformRouteTariffs({
    tx, originServiceZoneId: "zone_a", destinationServiceZoneId: "zone_b",
    packages: [{ packageCategory: "box", weightGrams: null }], currency: "NGN", now, routeSnapshot,
  });
  assert.equal(result.status, "REQUIRES_MEASUREMENT");
  assert.equal(result.options.length, 0);
  assert.equal(calls.availability, 0);
  assert.equal(calls.rates, 0);
});

test("missing directed corridor approval fails closed", async () => {
  const { tx } = transaction({ availability: null, rates: [rate()] });
  const result = await assessPlatformRouteTariffs({
    tx, originServiceZoneId: "zone_a", destinationServiceZoneId: "zone_b",
    packages, currency: "NGN", now, routeSnapshot,
  });
  assert.equal(result.status, "REQUIRES_OPERATIONAL_PRICING");
  assert.equal(result.options.length, 0);
});

test("overlapping tariff matches are reported as ambiguous rather than choosing one", async () => {
  const { tx } = transaction({ rates: [rate(), rate({ id: "rate_2", version: 4 })] });
  const result = await assessPlatformRouteTariffs({
    tx, originServiceZoneId: "zone_a", destinationServiceZoneId: "zone_b",
    packages, currency: "NGN", now, routeSnapshot,
  });
  assert.equal(result.status, "PRICING_AMBIGUOUS");
  assert.equal(result.options.length, 0);
});

test("package dimensions outside tariff limits do not receive a quote", async () => {
  const { tx } = transaction({ rates: [rate()] });
  const result = await assessPlatformRouteTariffs({
    tx, originServiceZoneId: "zone_a", destinationServiceZoneId: "zone_b",
    packages: [{ ...packages[0], lengthMm: 301 }], currency: "NGN", now, routeSnapshot,
  });
  assert.equal(result.status, "NO_COVERAGE");
  assert.equal(result.options.length, 0);
});

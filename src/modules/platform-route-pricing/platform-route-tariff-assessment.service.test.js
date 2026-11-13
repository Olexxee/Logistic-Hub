import test from "node:test";
import assert from "node:assert/strict";
import { assessPlatformRouteTariffs, rateFitsPackage } from "./platform-route-tariff-assessment.service.js";

const now = new Date("2026-11-13T12:00:00.000Z");
const routeSnapshot = { originServiceZoneId: "origin", destinationServiceZoneId: "destination" };
const pkg = (overrides = {}) => ({
  packageCategory: "GENERAL",
  weightGrams: 1500,
  lengthMm: 200,
  widthMm: 150,
  heightMm: 100,
  ...overrides,
});
const rate = (overrides = {}) => ({
  id: "rate-1",
  version: 1,
  parcelCategory: "GENERAL",
  minWeightGrams: 1001,
  maxWeightGrams: 3000,
  maxLengthMm: 300,
  maxWidthMm: 200,
  maxHeightMm: 150,
  customerTransportChargeMinor: 5000n,
  platformChargeMinor: 500n,
  driverPayoutMinor: 3500n,
  estimatedTransitMinutes: 90,
  ...overrides,
});
function transaction({ availability = { id: "route-availability" }, rates = [rate()] } = {}) {
  const calls = { availability: 0, rates: 0, rateWhere: null };
  return {
    calls,
    tx: {
      platformRouteAvailability: {
        findFirst: async args => { calls.availability += 1; calls.availabilityWhere = args.where; return availability; },
      },
      platformRouteRate: {
        findMany: async args => { calls.rates += 1; calls.rateWhere = args.where; return rates; },
      },
    },
  };
}
const assess = (tx, packages = [pkg()], extra = {}) => assessPlatformRouteTariffs({
  tx,
  originServiceZoneId: "origin",
  destinationServiceZoneId: "destination",
  packages,
  currency: "NGN",
  now,
  routeSnapshot,
  expiresAt: new Date("2026-11-13T13:00:00.000Z"),
  ...extra,
});

test("requires transaction, directed zones, valid currency and resolved package categories", async () => {
  const { tx } = transaction();
  await assert.rejects(() => assessPlatformRouteTariffs({ tx: {}, packages: [pkg()], currency: "NGN", now }), /transaction client/);
  await assert.rejects(() => assess(tx, [pkg()], { destinationServiceZoneId: "origin" }), /distinct/);
  await assert.rejects(() => assess(tx, [pkg()], { currency: "ngn" }), /uppercase/);
  await assert.rejects(() => assess(tx, [pkg({ packageCategory: "" })]), /category/);
});

test("returns requires measurement without querying route or rates when package weight is absent", async () => {
  const { tx, calls } = transaction();
  const result = await assess(tx, [pkg({ weightGrams: null })]);
  assert.equal(result.status, "REQUIRES_MEASUREMENT");
  assert.equal(result.options.length, 0);
  assert.equal(calls.availability, 0);
  assert.equal(calls.rates, 0);
});

test("requires operational pricing when the directed corridor is not enabled", async () => {
  const { tx, calls } = transaction({ availability: null });
  const result = await assess(tx);
  assert.equal(result.status, "REQUIRES_OPERATIONAL_PRICING");
  assert.equal(calls.rates, 0);
});

test("returns no coverage instead of inventing a fallback tariff", async () => {
  const { tx } = transaction({ rates: [] });
  const result = await assess(tx);
  assert.equal(result.status, "NO_COVERAGE");
  assert.equal(result.options.length, 0);
});

test("quotes all packages, sums money as BigInt and snapshots each package and rate", async () => {
  const second = rate({
    id: "rate-2",
    minWeightGrams: 1,
    maxWeightGrams: 1000,
    customerTransportChargeMinor: 2500n,
    platformChargeMinor: 250n,
    driverPayoutMinor: 1700n,
    estimatedTransitMinutes: 60,
  });
  const { tx, calls } = transaction({ rates: [rate(), second] });
  const result = await assess(tx, [
    pkg({ externalPackageRef: "parcel-A" }),
    pkg({ externalPackageRef: "parcel-B", weightGrams: 500 }),
  ]);
  assert.equal(result.status, "QUOTED");
  assert.equal(result.options[0].logisticsCost, 7500n);
  assert.equal(result.options[0].platformCharge, 750n);
  assert.equal(result.options[0].customerCharge, 8250n);
  assert.equal(result.options[0].driverPayout, 5200n);
  assert.equal(result.options[0].estimatedTransitMinutes, 90);
  assert.equal(result.options[0].rateSnapshot.length, 2);
  assert.equal(result.options[0].rateSnapshot[0].weightGrams, 1500);
  assert.equal(result.options[0].rateSnapshot[0].rateId, "rate-1");
  assert.equal(calls.rateWhere.currency, "NGN");
});

test("rejects ambiguous active matches rather than selecting an arbitrary tariff", async () => {
  const { tx } = transaction({ rates: [rate(), rate({ id: "rate-duplicate", version: 2 })] });
  const result = await assess(tx);
  assert.equal(result.status, "PRICING_AMBIGUOUS");
  assert.equal(result.options.length, 0);
});

test("does not match a tariff when a configured maximum dimension is unmeasured or exceeded", () => {
  assert.equal(rateFitsPackage(rate(), pkg({ lengthMm: null })), false);
  assert.equal(rateFitsPackage(rate(), pkg({ lengthMm: 301 })), false);
  assert.equal(rateFitsPackage(rate(), pkg({ lengthMm: 300 })), true);
});

test("ignores legacy noncanonical active tariff ranges", async () => {
  const { tx } = transaction({ rates: [rate({ minWeightGrams: 1000, maxWeightGrams: 3000 })] });
  const result = await assess(tx);
  assert.equal(result.status, "NO_COVERAGE");
});

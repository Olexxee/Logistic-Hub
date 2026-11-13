import test from "node:test";
import assert from "node:assert/strict";
import { assessPlatformDriverPayout } from "../src/modules/platform-operational-pricing/platform-driver-payout-assessment.service.js";

const now = new Date("2026-11-13T12:00:00.000Z");
const leg = { id: "leg-1", type: "LOCAL_PICKUP", originServiceZoneId: "zone-origin", destinationServiceZoneId: "zone-hub" };
const pkg = { id: "pkg-1", packageSequence: 1, packageCategory: "BOX", weightGrams: 1500 };
const rule = (overrides = {}) => ({
  id: "rule-1", version: 2, serviceZoneId: "zone-origin", legType: "LOCAL_PICKUP",
  parcelCategory: "BOX", minWeightGrams: 1000, maxWeightGrams: 2000,
  currency: "NGN", driverPayoutMinor: 125000n, status: "ACTIVE",
  effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), effectiveUntil: null,
  ...overrides,
});
function txWith(rules) {
  return { platformDriverPayoutRule: { findMany: async args => {
    assert.equal(args.where.serviceZoneId, "zone-origin");
    assert.equal(args.where.legType, "LOCAL_PICKUP");
    assert.equal(args.where.currency, "NGN");
    return rules;
  } } };
}

test("resolves a zone- and leg-specific driver payout without customer tariff input", async () => {
  const result = await assessPlatformDriverPayout({ tx: txWith([rule()]), leg, packages: [pkg], currency: "NGN", now });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.totalDriverPayoutMinor, "125000");
  assert.equal(result.packages[0].rule.id, "rule-1");
  assert.equal(result.packages[0].rule.version, 2);
  assert.equal("customerChargeMinor" in result, false);
});

test("sums independently matched package payouts using BigInt", async () => {
  const result = await assessPlatformDriverPayout({ tx: txWith([rule()]), leg, packages: [pkg, { ...pkg, id: "pkg-2" }], currency: "NGN", now });
  assert.equal(result.totalDriverPayoutMinor, "250000");
  assert.equal(result.packages.length, 2);
});

test("fails closed when package measurements are missing", async () => {
  const result = await assessPlatformDriverPayout({ tx: txWith([rule()]), leg, packages: [{ ...pkg, weightGrams: null }], currency: "NGN", now });
  assert.equal(result.status, "REQUIRES_MEASUREMENT");
});

test("fails closed when no exact payout rule exists", async () => {
  const result = await assessPlatformDriverPayout({ tx: txWith([]), leg, packages: [pkg], currency: "NGN", now });
  assert.equal(result.status, "NO_PAYOUT_RULE");
  assert.equal(result.totalDriverPayoutMinor, null);
});

test("rejects overlapping active payout rules as ambiguous", async () => {
  const result = await assessPlatformDriverPayout({ tx: txWith([rule(), rule({ id: "rule-2", minWeightGrams: 0, maxWeightGrams: 3000 })]), leg, packages: [pkg], currency: "NGN", now });
  assert.equal(result.status, "AMBIGUOUS_RULE");
});

test("uses the destination zone for final-mile payout rules", async () => {
  const finalMile = { ...leg, type: "FINAL_MILE" };
  const finalRule = rule({ serviceZoneId: "zone-hub", legType: "FINAL_MILE" });
  const tx = { platformDriverPayoutRule: { findMany: async args => {
    assert.equal(args.where.serviceZoneId, "zone-hub");
    assert.equal(args.where.legType, "FINAL_MILE");
    return [finalRule];
  } } };
  const result = await assessPlatformDriverPayout({ tx, leg: finalMile, packages: [pkg], currency: "NGN", now });
  assert.equal(result.status, "RESOLVED");
});

test("does not resolve hub-transfer or interstate legs as local-driver payouts", async () => {
  const result = await assessPlatformDriverPayout({ tx: txWith([]), leg: { ...leg, type: "INTERSTATE_TRANSPORT" }, packages: [pkg], currency: "NGN", now });
  assert.equal(result.status, "NOT_APPLICABLE");
});

test("rejects invalid input instead of silently coercing it", async () => {
  await assert.rejects(() => assessPlatformDriverPayout({ tx: txWith([]), leg, packages: [], currency: "NGN", now }), { code: "INVALID_DRIVER_PAYOUT_ASSESSMENT" });
});

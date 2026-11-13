import test from "node:test";
import assert from "node:assert/strict";
import {
  driverPayoutListSchema,
  driverPayoutReasonSchema,
  driverPayoutRuleIdSchema,
  driverPayoutRuleSchema,
} from "./platform-driver-payout.validators.js";

const valid = {
  serviceZoneId: "zone-1",
  legType: "LOCAL_PICKUP",
  parcelCategory: "GENERAL",
  minWeightGrams: 0,
  maxWeightGrams: 1000,
  currency: "ngn",
  driverPayoutMinor: "25000",
  effectiveFrom: "2026-11-01T00:00:00.000Z",
  reason: "Approved local payout",
};

test("normalizes payout currency and accepts a zero lower weight boundary", () => {
  const parsed = driverPayoutRuleSchema.safeParse(valid);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.currency, "NGN");
  assert.equal(parsed.data.minWeightGrams, 0);
});

test("rejects partner-executed leg types", () => {
  const parsed = driverPayoutRuleSchema.safeParse({ ...valid, legType: "HUB_TRANSFER" });
  assert.equal(parsed.success, false);
});

test("rejects non-positive payout and inverted weight/effective windows", () => {
  assert.equal(driverPayoutRuleSchema.safeParse({ ...valid, driverPayoutMinor: "0" }).success, false);
  assert.equal(driverPayoutRuleSchema.safeParse({ ...valid, maxWeightGrams: 0 }).success, false);
  assert.equal(driverPayoutRuleSchema.safeParse({
    ...valid,
    effectiveUntil: "2026-10-31T00:00:00.000Z",
  }).success, false);
});

test("rejects unknown properties and malformed list filters", () => {
  assert.equal(driverPayoutRuleSchema.safeParse({ ...valid, driverPayout: "extra" }).success, false);
  assert.equal(driverPayoutListSchema.safeParse({ status: "PENDING" }).success, false);
  assert.equal(driverPayoutReasonSchema.safeParse({ reason: "ok" }).success, false);
  assert.equal(driverPayoutRuleIdSchema.safeParse({ ruleId: "" }).success, false);
});

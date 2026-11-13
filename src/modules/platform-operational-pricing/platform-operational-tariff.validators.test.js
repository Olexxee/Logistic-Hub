import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityListSchema, availabilitySchema, tariffListSchema, tariffSchema,
} from "./platform-operational-tariff.validators.js";

const base = {
  scope: "LOCAL_ZONE",
  serviceZoneId: "zone-1",
  legType: "LOCAL_PICKUP",
  parcelCategory: "GENERAL",
  minWeightGrams: 1,
  maxWeightGrams: 1000,
  currency: "ngn",
  customerChargeMinor: "150000",
  platformChargeMinor: "0",
  reason: "Approved operational tariff",
};

test("LOCAL_ZONE tariff requires a service zone and a local leg type", () => {
  assert.equal(tariffSchema.safeParse(base).success, true);
  assert.equal(tariffSchema.safeParse({ ...base, legType: "INTERSTATE_TRANSPORT" }).success, false);
  assert.equal(tariffSchema.safeParse({ ...base, serviceZoneId: undefined }).success, false);
  assert.equal(tariffSchema.safeParse({ ...base, originHubPointId: "hub-a" }).success, false);
});

test("HUB_PAIR tariff is directed and requires interstate transport", () => {
  const valid = {
    ...base, scope: "HUB_PAIR", serviceZoneId: undefined, legType: "INTERSTATE_TRANSPORT",
    originHubPointId: "hub-a", destinationHubPointId: "hub-b",
  };
  assert.equal(tariffSchema.safeParse(valid).success, true);
  assert.equal(tariffSchema.safeParse({ ...valid, destinationHubPointId: "hub-a" }).success, false);
  assert.equal(tariffSchema.safeParse({ ...valid, legType: "FINAL_MILE" }).success, false);
});

test("HUB_HANDLING requires an explicit allow-listed additional operation", () => {
  const valid = {
    ...base, scope: "HUB_HANDLING", serviceZoneId: undefined, legType: undefined,
    hubPointId: "hub-a", operationType: "REPACKAGING",
  };
  assert.equal(tariffSchema.safeParse(valid).success, true);
  assert.equal(tariffSchema.safeParse({ ...valid, operationType: "NORMAL_CUSTODY" }).success, false);
  assert.equal(tariffSchema.safeParse({ ...valid, legType: "LOCAL_PICKUP" }).success, false);
});

test("tariffs require canonical weight bands and integer minor-unit strings", () => {
  assert.equal(tariffSchema.safeParse({ ...base, minWeightGrams: 1000, maxWeightGrams: 2000 }).success, false);
  assert.equal(tariffSchema.safeParse({ ...base, customerChargeMinor: "1.50" }).success, false);
  assert.equal(tariffSchema.safeParse({ ...base, platformChargeMinor: "-1" }).success, false);
  assert.equal(tariffSchema.safeParse({ ...base, effectiveUntil: "2020-01-01T00:00:00.000Z" }).success, false);
});

test("availability accepts only a valid scope locator and bounded effective window", () => {
  const valid = { scope: "HUB_PAIR", legType: "INTERSTATE_TRANSPORT", originHubPointId: "a", destinationHubPointId: "b", isEnabled: true, reason: "Corridor approved" };
  assert.equal(availabilitySchema.safeParse(valid).success, true);
  assert.equal(availabilitySchema.safeParse({ ...valid, destinationHubPointId: "a" }).success, false);
  assert.equal(availabilitySchema.safeParse({ ...valid, endsAt: "2020-01-01T00:00:00.000Z", startsAt: "2021-01-01T00:00:00.000Z" }).success, false);
  assert.equal(availabilityListSchema.safeParse({ unexpected: true }).success, false);
});

test("availability locator scope is mandatory", () => {
  assert.equal(availabilitySchema.safeParse({ isEnabled: false, reason: "Disable coverage" }).success, false);
});

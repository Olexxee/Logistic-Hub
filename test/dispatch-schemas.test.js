import test from "node:test";
import assert from "node:assert/strict";
import { acceptFareSchema, proposeFareSchema } from "../src/modules/dispatch/dispatch.schemas.js";

test("fare proposals require a positive integer amount in minor units", () => {
  assert.equal(proposeFareSchema.safeParse({ vehicleId: "vehicle-1", proposedFareMinor: "250000" }).success, true);
  assert.equal(proposeFareSchema.safeParse({ proposedFareMinor: "250000" }).success, false);
  assert.equal(proposeFareSchema.safeParse({ vehicleId: "vehicle-1", proposedFareMinor: "0" }).success, false);
  assert.equal(proposeFareSchema.safeParse({ vehicleId: "vehicle-1", proposedFareMinor: "250.50" }).success, false);
  assert.equal(proposeFareSchema.safeParse({ vehicleId: "vehicle-1", proposedFareMinor: 250 }).success, false);
});

test("fare acceptance requires an explicit offer id", () => {
  assert.equal(acceptFareSchema.safeParse({ offerId: "offer_123" }).success, true);
  assert.equal(acceptFareSchema.safeParse({}).success, false);
});


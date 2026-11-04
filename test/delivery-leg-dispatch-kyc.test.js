import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryLegDispatchRepository } from "../src/modules/delivery-legs/delivery-leg-dispatch.repository.js";

test("delivery-leg matching excludes suspended drivers and allows test tier only in test KYC mode",async()=>{
  let query;
  const repository=createDeliveryLegDispatchRepository({});
  await repository.findEligibleDrivers({driverProfile:{findMany:async args=>{query=args;return[];}}}, {
    originServiceZoneId:"origin-zone",destinationServiceZoneId:"destination-zone",
  },new Date("2026-11-04T12:00:00.000Z"));
  assert.deepEqual(query.where.kycTier.in,["FULL","TEST_LIMITED"]);
  assert.equal(query.where.suspendedAt,null);
  assert.equal(query.where.verificationStatus,"VERIFIED");
});

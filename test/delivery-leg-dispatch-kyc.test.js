import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryLegDispatchRepository } from "../src/modules/delivery-legs/delivery-leg-dispatch.repository.js";
import { env } from "../src/config/env.js";

test("delivery-leg matching excludes suspended and TEST_LIMITED drivers",async()=>{
  let query;
  const repository=createDeliveryLegDispatchRepository({});
  const now = new Date("2026-11-04T12:00:00.000Z");
  await repository.findEligibleDrivers({driverProfile:{findMany:async args=>{query=args;return[];}}}, {
    originServiceZoneId:"origin-zone",destinationServiceZoneId:"destination-zone",type:"LOCAL_PICKUP",
  },now);
  assert.deepEqual(query.where.kycTier.in,["FULL"]);
  assert.equal(query.where.suspendedAt,null);
  assert.equal(query.where.verificationStatus,"VERIFIED");
  assert.deepEqual(query.where.capabilities.some,{capability:"PICKUP_COLLECTION",status:"APPROVED"});
  assert.deepEqual(query.where.vehicles.some.serviceCapabilities.some,{capability:"PICKUP_COLLECTION",status:"APPROVED"});
  assert.deepEqual(query.where.lastLocationAt,{gte:new Date(now.getTime()-env.DRIVER_LOCATION_MAX_AGE_SECONDS*1000),lte:now});
});

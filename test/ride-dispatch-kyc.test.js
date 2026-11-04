import test from "node:test";
import assert from "node:assert/strict";
import { createRideDispatchService } from "../src/modules/rides/ride-dispatch.service.js";

test("passenger ride matching excludes test-limited and suspended drivers",async()=>{
  let query;
  const service=createRideDispatchService({
    prismaClient:{
      $transaction:callback=>callback({
        rideBooking:{findUnique:async()=>({id:"ride-1",passengerId:"passenger-1",status:"DRAFT"})},
        driverProfile:{findMany:async args=>{query=args;return[];}},
      }),
    },
  });
  await assert.rejects(service.requestMatching({rideBookingId:"ride-1",user:{id:"passenger-1"}}),error=>error.code==="NO_ELIGIBLE_DRIVERS");
  assert.equal(query.where.kycTier,"FULL");
  assert.equal(query.where.suspendedAt,null);
});

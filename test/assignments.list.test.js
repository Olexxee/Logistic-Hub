import test from "node:test";
import assert from "node:assert/strict";
import { createAssignmentsService } from "../src/modules/assignments/assignments.service.js";

function assignmentFixture() {
  return {
    id: "assignment-1",
    status: "ACCEPTED",
    agreedFareMinor: 125000n,
    currency: "NGN",
    acceptedAt: new Date("2026-10-30T10:00:00.000Z"),
    pickupAt: null,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    createdAt: new Date("2026-10-30T09:00:00.000Z"),
    updatedAt: new Date("2026-10-30T10:00:00.000Z"),
    parcelBooking: {
      id: "booking-1",
      publicReference: "LH-PCL-ABC123",
      status: "DRIVER_ASSIGNED",
      paymentStatus: "SUCCEEDED",
      pickupAddress: "12 Broad Street, Lagos",
      pickupInstructions: "Call on arrival",
      destinationAddress: "5 Marina Road, Lagos",
      recipientName: "Recipient",
      recipientPhone: "08000000000",
      parcelCategory: "DOCUMENTS",
      parcelDescription: "Contract documents",
      parcelSize: "SMALL",
      handlingInstructions: null,
      pickupLatitude: -1.2345678,
      pickupLongitude: 3.4567890,
      destinationLatitude: 1.2345678,
      destinationLongitude: 4.5678901,
    },
    deliveryLeg: {
      id: "leg-1",
      sequence: 1,
      type: "LOCAL_PICKUP",
      status: "ASSIGNED",
      originLatitude: -1.2345678,
      originLongitude: 3.4567890,
      destinationLatitude: 1.2345678,
      destinationLongitude: 4.5678901,
      originServiceZone: { id: "zone-1", name: "Ikeja" },
      destinationServiceZone: { id: "zone-2", name: "Lagos Island" },
      originHubPoint: null,
      destinationHubPoint: null,
    },
  };
}

test("listMine returns only the authenticated driver's paid parcel assignments", async () => {
  let captured;
  const fixture = assignmentFixture();
  const prismaClient = {
    driverAssignment: {
      findMany: async (args) => { captured = args; return [fixture]; },
      count: async (args) => { assert.deepEqual(args, { where: captured.where }); return 21; },
    },
  };
  const service = createAssignmentsService({ prismaClient, clock: () => new Date("2026-10-30T12:00:00.000Z") });

  const result = await service.listMine({ userId: "driver-user-1", page: 2, limit: 10 });

  assert.deepEqual(captured.where, {
    driverProfile: { is: { userId: "driver-user-1" } },
    parcelBookingId: { not: null },
    parcelBooking: { is: { paymentStatus: "SUCCEEDED" } },
  });
  assert.equal(captured.skip, 10);
  assert.equal(captured.take, 10);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "assignment-1");
  assert.equal(result.items[0].agreedFareMinor, "125000");
  assert.equal(result.items[0].booking.publicReference, "LH-PCL-ABC123");
  assert.equal(result.items[0].booking.recipientPhone, "08000000000");
  assert.equal(result.items[0].deliveryLeg.origin.latitude, "-1.2345678");
  assert.equal(result.items[0].deliveryLeg.destination.serviceZone.name, "Lagos Island");
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 21, totalPages: 3 });
});

test("listMine returns an empty page when the driver has no paid parcel assignments", async () => {
  const prismaClient = {
    driverAssignment: {
      findMany: async () => [],
      count: async () => 0,
    },
  };
  const service = createAssignmentsService({ prismaClient });
  const result = await service.listMine({ userId: "driver-user-2", page: 1, limit: 20 });
  assert.deepEqual(result, { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
});

import { createAssignmentsRepository } from "../src/modules/assignments/assignments.repository.js";

test("suspended driver cannot advance an existing assignment",async()=>{
  let mutationAttempted=false;
  const assignment={
    id:"assignment-1",status:"ACCEPTED",
    driverProfile:{id:"driver-1",userId:"driver-user",verificationStatus:"VERIFIED",kycTier:"FULL",suspendedAt:new Date()},
  };
  const repository=createAssignmentsRepository({
    $transaction:callback=>callback({
      driverAssignment:{
        findUnique:async()=>assignment,
        updateMany:async()=>{mutationAttempted=true;return{count:1};},
      },
    }),
  });
  const result=await repository.transition({assignmentId:"assignment-1",driverUserId:"driver-user",nextStatus:"ARRIVED_AT_PICKUP",now:new Date()});
  assert.deepEqual(result,{forbidden:true});
  assert.equal(mutationAttempted,false);
});

test("suspended driver cannot consume pickup or delivery verification codes",async()=>{
  let tokenLookup=false;
  const assignment={
    id:"assignment-1",status:"ARRIVED_AT_PICKUP",driverProfile:{id:"driver-1",userId:"driver-user",verificationStatus:"VERIFIED",kycTier:"FULL",suspendedAt:new Date()},
  };
  const repository=createAssignmentsRepository({
    $transaction:callback=>callback({
      driverAssignment:{findUnique:async()=>assignment},
      verificationToken:{findFirst:async()=>{tokenLookup=true;return{id:"token-1"};}},
    }),
  });
  const result=await repository.verifyCode({assignmentId:"assignment-1",driverUserId:"driver-user",action:"PICKUP",tokenHash:"hash",now:new Date()});
  assert.deepEqual(result,{forbidden:true});
  assert.equal(tokenLookup,false);
});


test("TEST_LIMITED drivers cannot execute a passenger-ride assignment",async()=>{
  const assignment={id:"ride-assignment-1",rideBookingId:"ride-1",status:"ACCEPTED",driverProfile:{userId:"driver-user",verificationStatus:"VERIFIED",kycTier:"TEST_LIMITED",suspendedAt:null}};
  const repository=createAssignmentsRepository({$transaction:callback=>callback({driverAssignment:{findUnique:async()=>assignment}})});
  const result=await repository.transition({assignmentId:assignment.id,driverUserId:"driver-user",nextStatus:"ARRIVED_AT_PICKUP",now:new Date()});
  assert.deepEqual(result,{forbidden:true});
});

test("TEST_LIMITED parcel completion does not create a driver payout record",async()=>{
  let payoutCreated=false;
  const assignment={
    id:"test-parcel-assignment",parcelBookingId:"parcel-1",rideBookingId:null,deliveryLegId:null,
    status:"ARRIVED_AT_DESTINATION",driverProfileId:"test-driver",
    driverProfile:{id:"test-driver",userId:"driver-user",verificationStatus:"VERIFIED",kycTier:"TEST_LIMITED",suspendedAt:null},
    parcelBooking:{id:"parcel-1",senderId:"sender-1",publicReference:"TEST-PARCEL-1"},
    agreedFareMinor:2500n,currency:"NGN",
  };
  const repository=createAssignmentsRepository({
    $transaction:callback=>callback({
      driverAssignment:{findUnique:async()=>assignment,update:async()=>({})},
      verificationToken:{findFirst:async()=>({id:"token-1"}),updateMany:async()=>({count:1})},
      parcelBooking:{update:async()=>({})},
      bookingEvent:{create:async()=>({})},
      driverProfile:{update:async()=>({})},
      driverPayout:{upsert:async()=>{payoutCreated=true;return{};}},
    }),
  });
  const result=await repository.verifyCode({assignmentId:assignment.id,driverUserId:"driver-user",action:"DELIVERY",tokenHash:"valid-hash",now:new Date()});
  assert.equal(result.status,"COMPLETED");
  assert.equal(payoutCreated,false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createDriversService } from "../src/modules/drivers/drivers.service.js";

function transactionClient({ profile, vehicle } = {}) {
  const events = [];
  const state = {
    profile: { id: "driver-1", userId: "user-1", verificationStatus: "PENDING", isOnline: true, isAvailable: true, suspendedAt: null, ...profile },
    vehicle: { id: "vehicle-1", driverProfileId: "driver-1", verificationStatus: "PENDING", isActive: false, driverProfile: { verificationStatus: "PENDING", suspendedAt: null }, ...vehicle },
    role: null,
    vehicleActivation: null,
  };
  const tx = {
    driverProfile: {
      findUnique: async () => ({ ...state.profile }),
      update: async ({ data }) => { state.profile = { ...state.profile, ...data }; return { ...state.profile }; },
    },
    vehicle: {
      updateMany: async ({ where, data }) => { state.vehicleActivation = { where, data }; return { count: 1 }; },
      findUnique: async () => ({ ...state.vehicle }),
      update: async ({ data }) => { state.vehicle = { ...state.vehicle, ...data }; return { ...state.vehicle }; },
    },
    user: { update: async ({ data }) => { state.role = data.role; return { id: "user-1", ...data }; } },
    operationalAuditEvent: { create: async ({ data }) => { events.push(data); return data; } },
  };
  return {
    prismaClient: { $transaction: callback => callback(tx) },
    events,
    state,
  };
}

test("driver approval activates verified vehicles, disables availability and audits the decision", async () => {
  const fixture = transactionClient({
    profile: { verificationStatus: "PENDING", isOnline: true, isAvailable: true },
  });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  const result = await service.reviewDriver({
    driverProfileId: "driver-1",
    verificationStatus: "VERIFIED",
    reason: "Identity and eligibility documents reviewed",
    actorUserId: "admin-1",
  });
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(result.isOnline, false);
  assert.equal(result.isAvailable, false);
  assert.equal(fixture.state.role, "DRIVER");
  assert.deepEqual(fixture.state.vehicleActivation, {
    where: { driverProfileId: "driver-1", verificationStatus: "VERIFIED" },
    data: { isActive: true },
  });
  assert.equal(fixture.events[0].action, "DRIVER_VERIFICATION_APPROVED");
  assert.equal(fixture.events[0].actorUserId, "admin-1");
});

test("driver rejection deactivates verified vehicles and audits the reason", async () => {
  const fixture = transactionClient({
    profile: { verificationStatus: "PENDING" },
  });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  await service.reviewDriver({
    driverProfileId: "driver-1",
    verificationStatus: "REJECTED",
    reason: "Required identity evidence was not provided",
    actorUserId: "admin-1",
  });
  assert.equal(fixture.state.role, "CUSTOMER");
  assert.deepEqual(fixture.state.vehicleActivation.data, { isActive: false });
  assert.equal(fixture.events[0].action, "DRIVER_VERIFICATION_REJECTED");
  assert.equal(fixture.events[0].reason, "Required identity evidence was not provided");
});

test("verified driver cannot be silently re-reviewed through onboarding approval route", async () => {
  const fixture = transactionClient({ profile: { verificationStatus: "VERIFIED" } });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  await assert.rejects(
    () => service.reviewDriver({
      driverProfileId: "driver-1",
      verificationStatus: "REJECTED",
      reason: "Reassessment requested by operations",
      actorUserId: "admin-1",
    }),
    error => error.statusCode === 409 && error.code === "DRIVER_NOT_REVIEWABLE",
  );
  assert.equal(fixture.events.length, 0);
});

test("vehicle approval does not activate a vehicle until its driver is verified", async () => {
  const fixture = transactionClient({
    vehicle: { verificationStatus: "PENDING", driverProfile: { verificationStatus: "PENDING", suspendedAt: null } },
  });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  const result = await service.reviewVehicle({
    vehicleId: "vehicle-1",
    verificationStatus: "VERIFIED",
    reason: "Vehicle registration evidence reviewed",
    actorUserId: "admin-1",
  });
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(result.isActive, false);
  assert.equal(fixture.events[0].action, "DRIVER_VEHICLE_VERIFICATION_APPROVED");
});

test("vehicle approval cannot reactivate a vehicle for a suspended driver", async () => {
  const fixture = transactionClient({
    vehicle: { verificationStatus: "PENDING", driverProfile: { verificationStatus: "VERIFIED", suspendedAt: new Date() } },
  });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  const result = await service.reviewVehicle({
    vehicleId: "vehicle-1",
    verificationStatus: "VERIFIED",
    reason: "Vehicle evidence reviewed and approved",
    actorUserId: "admin-1",
  });
  assert.equal(result.isActive, false);
});

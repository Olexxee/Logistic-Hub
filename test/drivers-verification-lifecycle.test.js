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
  assert.equal(result.kycTier, "TEST_LIMITED");
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

test("test-limited driver approval does not require identity documents", async () => {
  const fixture = transactionClient({ profile: { verificationStatus: "PENDING" } });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  const result = await service.reviewDriver({
    driverProfileId: "driver-1",
    verificationStatus: "VERIFIED",
    reason: "Approved for controlled parcel-delivery testing",
    actorUserId: "admin-1",
  });
  assert.equal(result.kycTier, "TEST_LIMITED");
  assert.equal(fixture.state.profile.verificationStatus, "VERIFIED");
});

test("rejected test-tier driver can resubmit with an audited explanation without full KYC", async () => {
  const fixture = transactionClient({ profile: { verificationStatus: "REJECTED", kycTier: "TEST_LIMITED" } });
  const service = createDriversService({ prismaClient: fixture.prismaClient });
  const result = await service.reapply({ userId: "user-1", reason: "Corrected my vehicle details and availability information." });
  assert.equal(result.verificationStatus, "PENDING");
  assert.equal(result.isOnline, false);
  assert.equal(result.isAvailable, false);
  assert.equal(fixture.events[0].action, "DRIVER_APPLICATION_RESUBMITTED");
  assert.equal(fixture.events[0].actorUserId, "user-1");
});

test("STRICT mode requires an approved identity document before driver approval", async () => {
  const state = { updated: false };
  const tx = {
    driverProfile: {
      findUnique: async () => ({ id: "driver-strict", userId: "user-strict", verificationStatus: "PENDING", kycTier: "UNASSESSED", isOnline: false, isAvailable: false, suspendedAt: null }),
      update: async () => { state.updated = true; return {}; },
    },
    driverVerificationDocument: { findFirst: async () => null },
  };
  const service = createDriversService({ prismaClient: { $transaction: callback => callback(tx) }, kycMode: "STRICT" });
  await assert.rejects(
    service.reviewDriver({ driverProfileId: "driver-strict", verificationStatus: "VERIFIED", reason: "Approve the strict KYC driver profile.", actorUserId: "admin-1" }),
    error => error.code === "DRIVER_IDENTITY_DOCUMENT_REQUIRED",
  );
  assert.equal(state.updated, false);
});

test("STRICT mode does not activate a legacy verified motor vehicle without approved licence and registration evidence", async () => {
  const vehicleUpdates = [];
  const profile = { id: "driver-strict", userId: "user-strict", verificationStatus: "PENDING", kycTier: "UNASSESSED", isOnline: false, isAvailable: false, suspendedAt: null };
  const tx = {
    driverProfile: {
      findUnique: async () => profile,
      update: async ({ data }) => ({ id: profile.id, userId: profile.userId, verificationStatus: data.verificationStatus, kycTier: data.kycTier, isOnline: data.isOnline, isAvailable: data.isAvailable }),
    },
    driverVerificationDocument: {
      findFirst: async ({ where }) => where.documentType === "IDENTITY" ? { id: "identity-approved" } : null,
      findMany: async () => [],
    },
    vehicle: {
      findMany: async () => [{ id: "car-1", type: "CAR" }, { id: "bike-1", type: "BICYCLE" }],
      updateMany: async args => { vehicleUpdates.push(args); return { count: 1 }; },
    },
    user: { update: async () => ({}) },
    operationalAuditEvent: { create: async ({ data }) => data },
  };
  const service = createDriversService({ prismaClient: { $transaction: callback => callback(tx) }, kycMode: "STRICT" });
  await service.reviewDriver({ driverProfileId: "driver-strict", verificationStatus: "VERIFIED", reason: "Identity evidence reviewed and accepted.", actorUserId: "admin-1" });
  assert.equal(vehicleUpdates.length, 2);
  assert.deepEqual(vehicleUpdates[0].where.id.in, ["bike-1"]);
  assert.equal(vehicleUpdates[0].data.isActive, true);
  assert.deepEqual(vehicleUpdates[1].where.id.in, ["car-1"]);
  assert.equal(vehicleUpdates[1].data.isActive, false);
});

test("STRICT mode requires both vehicle registration and driver licence before motor vehicle approval", async () => {
  const tx = {
    vehicle: {
      findUnique: async () => ({ id: "car-1", driverProfileId: "driver-1", verificationStatus: "PENDING", isActive: false, type: "CAR", driverProfile: { id: "driver-1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null } }),
      update: async () => { throw new Error("Vehicle must not be approved without required evidence."); },
    },
    driverVerificationDocument: {
      findFirst: async ({ where }) => where.documentType === "DRIVER_LICENSE" ? { id: "licence-approved" } : null,
    },
  };
  const service = createDriversService({ prismaClient: { $transaction: callback => callback(tx) }, kycMode: "STRICT" });
  await assert.rejects(
    service.reviewVehicle({ vehicleId: "car-1", verificationStatus: "VERIFIED", reason: "Approve the motor vehicle verification.", actorUserId: "admin-1" }),
    error => error.code === "VEHICLE_DOCUMENTS_REQUIRED",
  );
});

test("TEST mode can explicitly reassess a legacy verified UNASSESSED driver", async () => {
  const fixture = transactionClient({ profile: { verificationStatus: "VERIFIED", kycTier: "UNASSESSED" } });
  const service = createDriversService({ prismaClient: fixture.prismaClient, kycMode: "TEST" });
  const result = await service.reviewDriver({
    driverProfileId: "driver-1",
    verificationStatus: "VERIFIED",
    reason: "Legacy driver reassessed for controlled parcel testing.",
    actorUserId: "admin-1",
  });
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(result.kycTier, "TEST_LIMITED");
  assert.equal(fixture.events[0].action, "DRIVER_KYC_REASSESSED");
  assert.equal(fixture.events[0].metadata.isKycReassessment, true);
});

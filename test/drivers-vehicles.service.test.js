import test from "node:test";
import assert from "node:assert/strict";
import { createDriverVehiclesService } from "../src/modules/drivers/drivers.vehicles.service.js";

function fixture({ vehicle = null, activeAssignment = null, anotherVehicle = null } = {}) {
  const state = { created: null, updated: null, profileUpdate: null, audit: [] };
  const tx = {
    driverProfile: {
      findUnique: async () => ({ id: "driver-1", suspendedAt: null }),
      update: async ({ data }) => { state.profileUpdate = data; return { id: "driver-1" }; },
    },
    vehicle: {
      create: async ({ data, select }) => { state.created = data; return { id: "vehicle-new", ...data }; },
      findFirst: async ({ where }) => {
        if (where.id === "vehicle-1") return vehicle;
        if (where.id?.not === "vehicle-1") return anotherVehicle;
        return null;
      },
      update: async ({ data }) => { state.updated = data; return { id: "vehicle-1", ...vehicle, ...data }; },
    },
    driverAssignment: { findFirst: async () => activeAssignment },
    operationalAuditEvent: { create: async ({ data }) => { state.audit.push(data); return data; } },
  };
  const prismaClient = { $transaction: callback => callback(tx) };
  return { state, service: createDriverVehiclesService({ prismaClient, clock: () => new Date("2026-11-08T12:00:00Z") }) };
}

test("additional vehicle registration always starts pending and inactive and is audited", async () => {
  const { state, service } = fixture();
  const result = await service.addVehicle({
    userId: "driver-user",
    input: { type: "MOTORCYCLE", registrationPlate: " ab 123 cd ", make: "Honda" },
  });
  assert.equal(result.verificationStatus, "PENDING");
  assert.equal(result.isActive, false);
  assert.equal(state.created.registrationPlate, "AB 123 CD");
  assert.equal(state.audit[0].action, "DRIVER_VEHICLE_REGISTERED");
});

test("verified vehicle metadata is immutable; driver must register a replacement", async () => {
  const { service } = fixture({ vehicle: { id: "vehicle-1", verificationStatus: "VERIFIED", isActive: true } });
  await assert.rejects(
    service.updateVehicle({ userId: "driver-user", vehicleId: "vehicle-1", input: { make: "Different" } }),
    error => error.code === "VERIFIED_VEHICLE_IMMUTABLE",
  );
});

test("vehicle deactivation is blocked while that exact vehicle has an active assignment", async () => {
  const { service } = fixture({
    vehicle: { id: "vehicle-1", isActive: true, verificationStatus: "VERIFIED" },
    activeAssignment: { id: "assignment-1" },
  });
  await assert.rejects(
    service.deactivateVehicle({ userId: "driver-user", vehicleId: "vehicle-1" }),
    error => error.code === "VEHICLE_HAS_ACTIVE_ASSIGNMENT",
  );
});

test("deactivating the final eligible vehicle forces the driver offline", async () => {
  const { state, service } = fixture({
    vehicle: { id: "vehicle-1", isActive: true, verificationStatus: "VERIFIED" },
    anotherVehicle: null,
  });
  const result = await service.deactivateVehicle({ userId: "driver-user", vehicleId: "vehicle-1" });
  assert.equal(result.isActive, false);
  assert.equal(result.driverForcedOffline, true);
  assert.deepEqual(state.profileUpdate, { isOnline: false, isAvailable: false });
  assert.equal(state.audit[0].action, "DRIVER_VEHICLE_DEACTIVATED");
});

test("deactivating one vehicle does not force the driver offline when another verified vehicle remains active", async () => {
  const { state, service } = fixture({
    vehicle: { id: "vehicle-1", isActive: true, verificationStatus: "VERIFIED" },
    anotherVehicle: { id: "vehicle-2" },
  });
  const result = await service.deactivateVehicle({ userId: "driver-user", vehicleId: "vehicle-1" });
  assert.equal(result.driverForcedOffline, false);
  assert.equal(state.profileUpdate, null);
});

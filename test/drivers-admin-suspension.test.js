import test from "node:test";
import assert from "node:assert/strict";
import { createDriversAdminService } from "../src/modules/drivers/drivers.admin.service.js";
import { driverAdminStatusSchema } from "../src/modules/drivers/drivers.admin.validators.js";

function setup(initial = {}) {
  let profile = { id: "driver-1", suspendedAt: null, suspensionReason: null, reinstatedAt: null, isOnline: true, isAvailable: true, ...initial };
  const events = [];
  const tx = {
    driverProfile: {
      findUnique: async () => ({ ...profile }),
      update: async ({ data }) => { profile = { ...profile, ...data }; return { ...profile }; },
    },
    operationalAuditEvent: { create: async ({ data }) => { events.push(data); return data; } },
  };
  const prismaClient = { $transaction: async callback => callback(tx) };
  return { service: createDriversAdminService({ prismaClient }), events, getProfile: () => profile };
}

test("suspending a driver disables availability and writes an audit event", async () => {
  const { service, events, getProfile } = setup();
  const input = driverAdminStatusSchema.parse({ status: "SUSPENDED", reason: "Repeated safety policy violations" });
  const result = await service.setDriverStatus({ ...input, driverProfileId: "driver-1", actorUserId: "admin-1" });
  assert.ok(result.suspendedAt instanceof Date);
  assert.equal(result.suspensionReason, "Repeated safety policy violations");
  assert.equal(result.isOnline, false);
  assert.equal(result.isAvailable, false);
  assert.equal(getProfile().isAvailable, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "DRIVER_SUSPENDED");
  assert.equal(events[0].actorUserId, "admin-1");
});

test("reinstating a suspended driver clears suspension and records the reason", async () => {
  const { service, events } = setup({ suspendedAt: new Date("2026-10-01T00:00:00Z"), suspensionReason: "Review pending" });
  const result = await service.setDriverStatus({ driverProfileId: "driver-1", status: "ACTIVE", reason: "Appeal reviewed and cleared", actorUserId: "admin-1" });
  assert.equal(result.suspendedAt, null);
  assert.equal(result.suspensionReason, null);
  assert.ok(result.reinstatedAt instanceof Date);
  assert.equal(result.isOnline, false);
  assert.equal(events[0].action, "DRIVER_REINSTATED");
  assert.equal(events[0].reason, "Appeal reviewed and cleared");
});

test("repeated suspension and invalid reinstatement are rejected", async () => {
  const suspended = setup({ suspendedAt: new Date() });
  await assert.rejects(() => suspended.service.setDriverStatus({ driverProfileId: "driver-1", status: "SUSPENDED", reason: "Repeated breach" }), error => error.code === "DRIVER_ALREADY_SUSPENDED" && error.statusCode === 409);
  const active = setup();
  await assert.rejects(() => active.service.setDriverStatus({ driverProfileId: "driver-1", status: "ACTIVE" }), error => error.code === "DRIVER_NOT_SUSPENDED" && error.statusCode === 409);
});

test("suspension reason is mandatory and bounded", () => {
  assert.equal(driverAdminStatusSchema.safeParse({ status: "SUSPENDED" }).success, false);
  assert.equal(driverAdminStatusSchema.safeParse({ status: "SUSPENDED", reason: "No" }).success, false);
  assert.equal(driverAdminStatusSchema.safeParse({ status: "ACTIVE", reason: "Reinstated after review" }).success, true);
});

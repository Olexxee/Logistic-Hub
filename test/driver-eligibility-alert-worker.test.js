import test from "node:test";
import assert from "node:assert/strict";
import { createDriverEligibilityAlertWorker } from "../src/shared/jobs/driver-eligibility-alert-worker.service.js";

function createHarness() {
  const notifications = new Map();
  const cases = [];
  const audits = [];
  const assignment = {
    id: "assignment-eligibility-01",
    parcelBookingId: "parcel-01",
    driverProfileId: "driver-profile-01",
    vehicleId: "vehicle-01",
    deliveryLegId: null,
    status: "ACCEPTED",
    pickupAt: null,
    executionHoldAt: null,
    parcelBooking: {
      id: "parcel-01",
      paymentStatus: "SUCCEEDED",
      pickupServiceZoneId: "zone-a",
      destinationServiceZoneId: "zone-b",
    },
    deliveryLeg: null,
    driverProfile: { id: "driver-profile-01", userId: "driver-user-01" },
  };
  const tx = {
    // The worker takes a row-level lock before re-reading eligibility.
    $queryRaw: async () => [],
    driverAssignment: { findUnique: async () => assignment },
    serviceZone: { findMany: async () => [{ id: "zone-a" }, { id: "zone-b" }] },
    hubPoint: { findMany: async () => [] },
    driverProfile: { findFirst: async () => null },
    user: { findMany: async () => [{ id: "admin-user-01" }] },
    notification: {
      findUnique: async ({ where }) => notifications.has(where.deliveryKey) ? { id: "existing" } : null,
      create: async ({ data }) => { notifications.set(data.deliveryKey, data); return data; },
    },
    operationalCase: { create: async ({ data }) => { cases.push(data); return { id: "case-01" }; } },
    operationalAuditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  const prismaClient = {
    $transaction: async work => work(tx),
    driverAssignment: { findMany: async () => [assignment] },
  };
  return { prismaClient, notifications, cases, audits };
}

test("creates one case and recipient notifications for a pre-pickup eligibility failure", async () => {
  const harness = createHarness();
  const worker = createDriverEligibilityAlertWorker({ prismaClient: harness.prismaClient, clock: () => new Date("2026-11-09T12:00:00.000Z") });

  const result = await worker.runOnce();

  assert.deepEqual(result, { scanned: 1, alertsCreated: 1 });
  assert.equal(harness.cases.length, 1);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.notifications.size, 2);
  assert.equal(harness.cases[0].priority, "HIGH");
  assert.equal(harness.cases[0].evidence.reasonCode, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
  assert.equal(harness.notifications.get("drv-eligibility:assignment-eligibility-01:DRIVER_EXECUTION_ELIGIBILITY_CHANGED").userId, "driver-user-01");
});

test("deduplicates repeated scans for the same assignment and eligibility reason", async () => {
  const harness = createHarness();
  const worker = createDriverEligibilityAlertWorker({ prismaClient: harness.prismaClient, clock: () => new Date("2026-11-09T12:00:00.000Z") });

  await worker.runOnce();
  const replay = await worker.runOnce();

  assert.deepEqual(replay, { scanned: 1, alertsCreated: 0 });
  assert.equal(harness.cases.length, 1);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.notifications.size, 2);
});

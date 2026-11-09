import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createOperationsControlRouter } from "../src/modules/operations-control/operations-control.routes.js";

async function serve(role, run) {
  const prismaClient = {
    $transaction: async (callback) => callback(prismaClient),
    parcelBooking: { count: async () => 10 },
    deliveryLeg: { count: async ({ where }) => where.status === "FAILED" ? 2 : 7 },
    custodyHandover: { count: async () => 3 },
    hubIntakeRecord: { count: async () => 1 },
    operationalCase: { count: async ({ where }) => where.priority === "CRITICAL" ? 1 : where.assignedToUserId === null ? 2 : 4 },
    partnerDeliveryAssignment: { count: async () => 5 },
    driverAssignment: { count: async () => 6 },
  };
  const app = express();
  app.use("/api/v1", createOperationsControlRouter({
    prismaClient,
    clock: () => new Date("2026-10-31T12:00:00.000Z"),
    authMiddleware: (req, _res, next) => { req.user = { role }; next(); },
    roleMiddleware: expected => (req, res, next) => req.user.role === expected
      ? next()
      : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("operations overview is ADMIN-only", async () => {
  await serve("SUPPORT", async base => {
    const response = await fetch(`${base}/api/v1/admin/operations/overview`);
    assert.equal(response.status, 403);
  });
});

test("ADMIN receives aggregate operational metrics without record-level data", async () => {
  await serve("ADMIN", async base => {
    const response = await fetch(`${base}/api/v1/admin/operations/overview`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, {
      generatedAt: "2026-10-31T12:00:00.000Z",
      metrics: {
        activeShipments: 10,
        activeDeliveryLegs: 7,
        failedDeliveryLegs: 2,
        pendingCustodyHandovers: 3,
        hubIntakeExceptions: 1,
        activeOperationalCases: 4,
        criticalOperationalCases: 1,
        unassignedOperationalCases: 2,
        activePartnerAssignments: 5,
        heldParcelAssignments: 6,
      },
    });
    assert.equal(JSON.stringify(body).includes("pickupAddress"), false);
    assert.equal(JSON.stringify(body).includes("recipientPhone"), false);
  });
});

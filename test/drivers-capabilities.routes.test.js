import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createDriversRouter } from "../src/modules/drivers/drivers.routes.js";

async function withServer(role, prismaClient, run) {
  const authMiddleware = (req, _res, next) => { req.user = { id: "user-1", role }; next(); };
  const roleMiddleware = expected => (req, res, next) => {
    if (req.user?.role !== expected) return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
    return next();
  };
  const app = express();
  app.use(express.json());
  app.use("/drivers", createDriversRouter({ prismaClient, authMiddleware, roleMiddleware, email: { configured: false } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function emptyPrisma() {
  return {
    driverProfile: { findUnique: async () => ({ id: "driver-1" }) },
    vehicle: { findFirst: async () => ({ id: "vehicle-1" }) },
    driverCapabilityGrant: { findMany: async () => [] },
    vehicleServiceCapability: { findMany: async () => [] },
    $transaction: async callback => callback({
      driverProfile: { findUnique: async () => ({ id: "driver-1" }) },
      vehicle: { findFirst: async () => ({ id: "vehicle-1" }) },
      driverCapabilityGrant: {
        findUnique: async () => null,
        create: async ({ data }) => ({ id: "grant-1", ...data, requestedAt: new Date(), reviewedAt: null, reviewReason: null }),
      },
      vehicleServiceCapability: {
        findUnique: async () => null,
        create: async ({ data }) => ({ id: "vehicle-cap-1", ...data, requestedAt: new Date(), reviewedAt: null, reviewReason: null }),
      },
      operationalAuditEvent: { create: async ({ data }) => data },
    }),
  };
}

test("drivers can request only a capability; caller-supplied approval fields are rejected", async () => {
  await withServer("DRIVER", emptyPrisma(), async base => {
    const response = await fetch(`${base}/drivers/me/capabilities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "LOCAL_DISPATCH", status: "APPROVED", reviewedByUserId: "user-1" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  });
});

test("driver capability request is created as REQUESTED and never self-approved", async () => {
  await withServer("DRIVER", emptyPrisma(), async base => {
    const response = await fetch(`${base}/drivers/me/capabilities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "LOCAL_DISPATCH" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.data.status, "REQUESTED");
    assert.equal(body.data.capability, "LOCAL_DISPATCH");
  });
});

test("driver cannot access Admin capability review routes", async () => {
  await withServer("DRIVER", emptyPrisma(), async base => {
    const response = await fetch(`${base}/drivers/admin/drivers/driver-1/capabilities`);
    assert.equal(response.status, 403);
  });
});

test("Admin can read the capability queue for a driver", async () => {
  await withServer("ADMIN", emptyPrisma(), async base => {
    const response = await fetch(`${base}/drivers/admin/drivers/driver-1/capabilities`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.items, []);
  });
});


test("Admin capability approval is transactional and records the decision in driver audit history", async () => {
  let status = "REQUESTED";
  const auditEvents = [];
  const prismaClient = {
    driverProfile: { findUnique: async () => ({ id: "driver-1" }) },
    driverCapabilityGrant: { findMany: async () => [] },
    vehicle: { findFirst: async () => ({ id: "vehicle-1" }) },
    vehicleServiceCapability: { findMany: async () => [] },
    $transaction: async callback => callback({
      driverProfile: { findUnique: async () => ({ verificationStatus: "VERIFIED", suspendedAt: null }) },
      driverCapabilityGrant: {
        findUnique: async () => ({ id: "grant-1", driverProfileId: "driver-1", capability: "LOCAL_DISPATCH", status, reviewReason: null }),
        updateMany: async ({ data }) => { status = data.status; return { count: 1 }; },
      },
      vehicle: { findUnique: async () => ({ driverProfileId: "driver-1" }) },
      operationalAuditEvent: { create: async ({ data }) => { auditEvents.push(data); return data; } },
    }),
  };
  await withServer("ADMIN", prismaClient, async base => {
    const response = await fetch(`${base}/drivers/admin/drivers/driver-1/capabilities/LOCAL_DISPATCH`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "APPROVED", reason: "Identity and operating profile reviewed." }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.status, "APPROVED");
  });
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].entityType, "DRIVER_PROFILE");
  assert.equal(auditEvents[0].entityId, "driver-1");
  assert.equal(auditEvents[0].action, "CAPABILITY_APPROVED");
});

test("Admin cannot approve a capability for an unverified driver", async () => {
  let status = "REQUESTED";
  const auditEvents = [];
  const prismaClient = {
    driverProfile: { findUnique: async () => ({ id: "driver-1" }) },
    driverCapabilityGrant: { findMany: async () => [] },
    vehicle: { findFirst: async () => ({ id: "vehicle-1" }) },
    vehicleServiceCapability: { findMany: async () => [] },
    $transaction: async callback => callback({
      driverProfile: { findUnique: async () => ({ verificationStatus: "PENDING", suspendedAt: null }) },
      driverCapabilityGrant: {
        findUnique: async () => ({ id: "grant-1", driverProfileId: "driver-1", capability: "LOCAL_DISPATCH", status, reviewReason: null }),
        updateMany: async ({ data }) => { status = data.status; return { count: 1 }; },
      },
      vehicle: { findUnique: async () => ({ driverProfileId: "driver-1" }) },
      operationalAuditEvent: { create: async ({ data }) => { auditEvents.push(data); return data; } },
    }),
  };
  await withServer("ADMIN", prismaClient, async base => {
    const response = await fetch(`${base}/drivers/admin/drivers/driver-1/capabilities/LOCAL_DISPATCH`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "APPROVED", reason: "Review completed with required evidence." }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "DRIVER_PROFILE_NOT_APPROVED");
  });
  assert.equal(status, "REQUESTED");
  assert.equal(auditEvents.length, 0);
});

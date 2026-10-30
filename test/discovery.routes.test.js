import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDiscoveryRouter } from "../src/modules/discovery/discovery.routes.js";
import { requireRole } from "../src/modules/auth/auth.middleware.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function createApp(prismaClient) {
  const app = express();
  app.use(express.json());
  const authMiddleware = (req, _res, next) => {
    req.user = { id: req.get("x-user-id") ?? "test-user", role: req.get("x-user-role") ?? "CUSTOMER" };
    next();
  };
  app.use("/api/v1", createDiscoveryRouter({ prismaClient, authMiddleware, roleMiddleware: requireRole }));
  return app;
}

test("admin user directory rejects non-admin users and returns safe paginated records to admins", async () => {
  const prismaClient = { user: {
    findMany: async () => [{ id: "user-1", fullName: "Ada", email: "ada@example.test", phone: null, role: "DRIVER", status: "ACTIVE", emailVerifiedAt: null, phoneVerifiedAt: null, createdAt: new Date("2026-10-30T00:00:00.000Z") }],
    count: async () => 1,
  } };
  await withServer(createApp(prismaClient), async base => {
    const denied = await fetch(`${base}/api/v1/admin/users?q=ada`);
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${base}/api/v1/admin/users?q=ada`, { headers: { "x-user-role": "ADMIN" } });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.data.items[0].id, "user-1");
    assert.equal(body.data.pagination.total, 1);
  });
});

test("driver assignment discovery is driver-only and responds with an empty page for no profile", async () => {
  const prismaClient = { driverProfile: { findUnique: async () => null } };
  await withServer(createApp(prismaClient), async base => {
    const denied = await fetch(`${base}/api/v1/driver/assignments/mine`);
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${base}/api/v1/driver/assignments/mine?page=1&limit=10`, {
      headers: { "x-user-role": "DRIVER" },
    });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.deepEqual(body.data.items, []);
    assert.equal(body.data.pagination.page, 1);
  });
});

test("membership discovery requires authentication but does not require a pre-existing handover", async () => {
  const prismaClient = {
    transportPartnerMember: { findMany: async () => [] },
    hubPointOperator: { findMany: async () => [] },
  };
  await withServer(createApp(prismaClient), async base => {
    const partner = await fetch(`${base}/api/v1/partner/memberships/mine`);
    const hub = await fetch(`${base}/api/v1/hub-operator/memberships/mine`);
    assert.equal(partner.status, 200);
    assert.equal(hub.status, 200);
    assert.deepEqual((await partner.json()).data.items, []);
    assert.deepEqual((await hub.json()).data.items, []);
  });
});

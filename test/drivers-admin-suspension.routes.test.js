import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createDriversRouter } from "../src/modules/drivers/drivers.routes.js";

async function serve(role, run) {
  let profile = { id: "driver-1", suspendedAt: null, suspensionReason: null, reinstatedAt: null, isOnline: true, isAvailable: true };
  const audit = [];
  const tx = {
    driverProfile: {
      findUnique: async () => ({ ...profile }),
      update: async ({ data }) => { profile = { ...profile, ...data }; return { ...profile }; },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { audit.unshift({ id: "audit-1", createdAt: new Date(), ...data }); return data; },
      findMany: async () => audit,
      count: async () => audit.length,
    },
  };
  const prismaClient = {
    driverProfile: { findUnique: async () => ({ id: "driver-1" }) },
    $transaction: async callback => callback(tx),
    operationalAuditEvent: tx.operationalAuditEvent,
  };
  const authMiddleware = (req, _res, next) => { req.user = { id: "admin-1", role }; next(); };
  const roleMiddleware = expected => (req, res, next) => req.user?.role === expected ? next() : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  const app = express();
  app.use(express.json());
  app.use("/drivers", createDriversRouter({ prismaClient, authMiddleware, roleMiddleware, email: { configured: false } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, () => ({ profile, audit })); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("driver suspension and audit endpoints are ADMIN-only", async () => {
  await serve("CUSTOMER", async base => {
    const response = await fetch(`${base}/drivers/admin/drivers/driver-1/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "SUSPENDED", reason: "Safety review" }) });
    assert.equal(response.status, 403);
  });
});

test("ADMIN can suspend a driver and retrieve its audit history", async () => {
  await serve("ADMIN", async (base, state) => {
    const response = await fetch(`${base}/drivers/admin/drivers/driver-1/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "SUSPENDED", reason: "Safety review" }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.driver.isOnline, false);
    assert.equal(payload.data.driver.isAvailable, false);
    assert.equal(payload.data.driver.suspensionReason, "Safety review");
    assert.equal(state().audit[0].action, "DRIVER_SUSPENDED");
    const history = await fetch(`${base}/drivers/admin/drivers/driver-1/audit`);
    assert.equal(history.status, 200);
    assert.equal((await history.json()).data.items[0].action, "DRIVER_SUSPENDED");
  });
});

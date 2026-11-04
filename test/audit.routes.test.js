import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAuditRouter } from "../src/modules/audit/audit.routes.js";

async function serve(role, run) {
  let query;
  const prismaClient = { operationalAuditEvent: {
    findMany: async args => { query = args; return [{ id: "event-1", entityType: "DRIVER_PROFILE", entityId: "driver-1", action: "DRIVER_SUSPENDED" }]; },
    count: async () => 1,
  } };
  const app = express();
  app.use("/admin/audit-events", createAuditRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => { req.user = { role }; next(); },
    roleMiddleware: expected => (req, res, next) => req.user.role === expected ? next() : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, () => query); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("audit history denies every non-ADMIN role", async () => {
  for (const role of ["CUSTOMER", "DRIVER", "SUPPORT", "HUB_OPERATOR", "PARTNER_OPERATOR"]) {
    await serve(role, async base => {
      const response = await fetch(`${base}/admin/audit-events`);
      assert.equal(response.status, 403, `${role} must be denied`);
    });
  }
});

test("admin audit history supports entity and action filters", async () => {
  await serve("ADMIN", async (base, getQuery) => {
    const response = await fetch(`${base}/admin/audit-events?entityType=DRIVER_PROFILE&entityId=driver-1&action=DRIVER_SUSPENDED&actorUserId=admin-1&page=1&limit=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].id, "event-1");
    assert.deepEqual(getQuery().where, { entityType: "DRIVER_PROFILE", entityId: "driver-1", action: "DRIVER_SUSPENDED", actorUserId: "admin-1" });
  });
});

test("audit history accepts entity types emitted by other operational modules", async () => {
  await serve("ADMIN", async (base, getQuery) => {
    const response = await fetch(`${base}/admin/audit-events?entityType=REFUND_REQUEST&action=REFUND_PROVIDER_WEBHOOK_STATUS_UPDATED`);
    assert.equal(response.status, 200);
    assert.deepEqual(getQuery().where, {
      entityType: "REFUND_REQUEST",
      action: "REFUND_PROVIDER_WEBHOOK_STATUS_UPDATED",
    });
  });
});

test("audit history rejects oversized entity filters and unbounded page sizes", async () => {
  await serve("ADMIN", async base => {
    const longEntityType = "x".repeat(81);
    const invalidEntity = await fetch(`${base}/admin/audit-events?entityType=${longEntityType}`);
    assert.equal(invalidEntity.status, 400);
    const invalidLimit = await fetch(`${base}/admin/audit-events?limit=101`);
    assert.equal(invalidLimit.status, 400);
  });
});

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

test("audit history is ADMIN-only", async () => {
  await serve("CUSTOMER", async base => {
    const response = await fetch(`${base}/admin/audit-events`);
    assert.equal(response.status, 403);
  });
});

test("admin audit history supports entity and action filters", async () => {
  await serve("ADMIN", async (base, getQuery) => {
    const response = await fetch(`${base}/admin/audit-events?entityType=DRIVER_PROFILE&entityId=driver-1&action=DRIVER_SUSPENDED&page=1&limit=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].id, "event-1");
    assert.deepEqual(getQuery().where, { entityType: "DRIVER_PROFILE", entityId: "driver-1", action: "DRIVER_SUSPENDED" });
  });
});

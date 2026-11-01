import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createPartnerExecutionRouter } from "../src/modules/partner-execution/partner-execution.routes.js";

async function withServer(role, prismaClient, callback) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createPartnerExecutionRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => { req.user = { id: "admin-1", role }; next(); },
    roleMiddleware: requiredRole => (req, res, next) => req.user.role === requiredRole
      ? next()
      : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}/api/v1`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("partner membership directory is ADMIN-only and returns pagination", async () => {
  const prismaClient = {
    transportPartner: { findUnique: async () => ({ id: "partner-1" }) },
    transportPartnerMember: {
      findMany: async () => [{ id: "member-1", role: "OWNER", isActive: true }],
      count: async () => 1,
    },
  };
  await withServer("CUSTOMER", prismaClient, async base => {
    const denied = await fetch(`${base}/admin/transport-partners/partner-1/members`);
    assert.equal(denied.status, 403);
  });
  await withServer("ADMIN", prismaClient, async base => {
    const response = await fetch(`${base}/admin/transport-partners/partner-1/members?page=1&limit=10&role=OWNER&isActive=true`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items.length, 1);
    assert.deepEqual(body.data.pagination, { page: 1, limit: 10, total: 1, totalPages: 1 });
    const invalid = await fetch(`${base}/admin/transport-partners/partner-1/members?isActive=maybe`);
    assert.equal(invalid.status, 400);
  });
});

test("partner membership mutations reject missing audit reasons", async () => {
  const prismaClient = {};
  await withServer("ADMIN", prismaClient, async base => {
    const add = await fetch(`${base}/admin/transport-partners/partner-1/members`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-1", role: "OPERATIONS" }),
    });
    assert.equal(add.status, 400);
    const update = await fetch(`${base}/admin/transport-partners/partner-1/members/member-1`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(update.status, 400);
  });
});

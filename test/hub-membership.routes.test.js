import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCustodyRouter } from "../src/modules/custody/custody.routes.js";
import { requireRole } from "../src/modules/auth/auth.middleware.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function createApp(prismaClient) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createCustodyRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => {
      req.user = { id: "admin-1", role: req.get("x-user-role") ?? "CUSTOMER" };
      next();
    },
    roleMiddleware: requireRole,
  }));
  app.use(errorHandler);
  return app;
}

test("hub membership directory is ADMIN-only", async () => {
  const app = createApp({ hubPoint: { findUnique: async () => ({ id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" }) } });
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators`, {
      headers: { "x-user-role": "SUPPORT" },
    });
    assert.equal(response.status, 403);
  });
});

test("hub membership mutations require an audit reason", async () => {
  const app = createApp({});
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators/operator-1/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({ role: "MANAGER" }),
    });
    assert.equal(response.status, 400);
  });
});

test("admin hub membership list returns pagination and scoped membership data", async () => {
  const prismaClient = {
    hubPoint: { findUnique: async () => ({ id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" }) },
    hubPointOperator: {
      findMany: async () => [{ id: "operator-1", role: "MANAGER", isActive: true, user: { id: "user-1", fullName: "Hub Manager" } }],
      count: async () => 1,
    },
  };
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators?page=1&limit=10&isActive=true`, {
      headers: { "x-user-role": "ADMIN" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].user.fullName, "Hub Manager");
    assert.equal(body.data.pagination.total, 1);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createExecutionReadinessRouter } from "../src/modules/execution-readiness/execution-readiness.routes.js";

async function withServer(role, prismaClient, callback) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createExecutionReadinessRouter({
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

test("execution readiness assessment is ADMIN-only", async () => {
  await withServer("CUSTOMER", {}, async base => {
    const response = await fetch(`${base}/admin/delivery-legs/leg-1/execution-readiness`);
    assert.equal(response.status, 403);
  });
});

test("Admin execution readiness returns 404 for an unknown delivery leg", async () => {
  const prismaClient = {
    $transaction: async callback => callback({
      deliveryLeg: { findUnique: async () => null },
    }),
  };
  await withServer("ADMIN", prismaClient, async base => {
    const response = await fetch(`${base}/admin/delivery-legs/unknown-leg/execution-readiness`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "DELIVERY_LEG_NOT_FOUND");
  });
});

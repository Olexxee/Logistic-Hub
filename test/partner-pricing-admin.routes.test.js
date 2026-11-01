import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createPartnerPricingRouter } from "../src/modules/partner-pricing/partner-pricing.routes.js";

async function requestAs(role) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createPartnerPricingRouter({
    prismaClient: { transportPartner: { findMany: async () => [], count: async () => 0 } },
    authMiddleware: (req, _res, next) => { req.user = { id: "test-user", role }; next(); },
    adminMiddleware: (req, res, next) => req.user.role === "ADMIN" ? next() : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/transport-partners`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("partner administration is restricted to ADMIN", async () => {
  const customer = await requestAs("CUSTOMER");
  assert.equal(customer.status, 403);
  const admin = await requestAs("ADMIN");
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body.data.items, []);
});


test("partner directory returns paginated metadata and validates filters", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createPartnerPricingRouter({
    prismaClient: { transportPartner: { findMany: async () => [], count: async () => 0 } },
    authMiddleware: (req, _res, next) => { req.user = { id: "admin", role: "ADMIN" }; next(); },
    adminMiddleware: (_req, _res, next) => next(),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/transport-partners`;
    const valid = await fetch(`${base}?page=2&limit=10&status=ACTIVE&search=North`);
    assert.equal(valid.status, 200);
    const body = await valid.json();
    assert.deepEqual(body.data.pagination, { page: 2, limit: 10, total: 0, totalPages: 0 });
    const invalidResponse = await fetch(`${base}?page=0`);
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json()).error.code, "VALIDATION_ERROR");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("partner profile and status mutations require an audit reason", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createPartnerPricingRouter({
    prismaClient: { transportPartner: { findMany: async () => [], count: async () => 0 } },
    authMiddleware: (req, _res, next) => { req.user = { id: "admin", role: "ADMIN" }; next(); },
    adminMiddleware: (_req, _res, next) => next(),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/transport-partners/partner-1`;
    const profile = await fetch(base, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Updated Partner" }) });
    assert.equal(profile.status, 400);
    const status = await fetch(`${base}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "SUSPENDED" }) });
    assert.equal(status.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

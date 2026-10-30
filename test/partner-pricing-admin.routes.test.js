import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createPartnerPricingRouter } from "../src/modules/partner-pricing/partner-pricing.routes.js";

async function requestAs(role) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createPartnerPricingRouter({
    prismaClient: { transportPartner: { findMany: async () => [] } },
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

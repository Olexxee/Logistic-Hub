import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createGeographyAdminRouter } from "../src/modules/geography/geography.admin.routes.js";
import { createServiceZonesRouter } from "../src/modules/geography/service-zones.routes.js";

async function requestAs(role, path, method = "GET") {
  const prismaClient = {
    country: { findMany: async () => [] },
    state: { findMany: async () => [] },
    lGA: { findMany: async () => [] },
    serviceZone: { findMany: async () => [] },
    pricingRule: { findMany: async () => [] },
  };
  const options = {
    prismaClient,
    authMiddleware: (req, _res, next) => { req.user = { id: "user-1", role }; next(); },
    roleMiddleware: expected => (req, res, next) => req.user.role === expected
      ? next()
      : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  };
  const app = express();
  app.use("/geography/admin", createGeographyAdminRouter(options));
  app.use("/service-zones", createServiceZonesRouter(options));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("geography hierarchy administration remains ADMIN-only", async () => {
  assert.equal((await requestAs("CUSTOMER", "/geography/admin/countries")).status, 403);
  assert.equal((await requestAs("SUPPORT", "/geography/admin/states")).status, 403);
  assert.equal((await requestAs("ADMIN", "/geography/admin/countries")).status, 200);
});

test("service-zone administration remains ADMIN-only", async () => {
  assert.equal((await requestAs("CUSTOMER", "/service-zones/admin")).status, 403);
  assert.equal((await requestAs("SUPPORT", "/service-zones/admin")).status, 403);
  assert.equal((await requestAs("ADMIN", "/service-zones/admin")).status, 200);
});


test("service-zone readiness audit remains ADMIN-only", async () => {
  assert.equal((await requestAs("CUSTOMER", "/service-zones/admin/readiness")).status, 403);
  assert.equal((await requestAs("SUPPORT", "/service-zones/admin/readiness")).status, 403);
  const admin = await requestAs("ADMIN", "/service-zones/admin/readiness");
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.serviceType, "PARCEL_DELIVERY");
  assert.equal(admin.body.data.summary.totalZones, 0);
});

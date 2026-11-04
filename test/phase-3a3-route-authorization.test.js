import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createSupportRouter } from "../src/modules/support/support.routes.js";
import { createFinanceRouter } from "../src/modules/finance/finance.routes.js";
import { createGeographyAdminRouter } from "../src/modules/geography/geography.admin.routes.js";
import { createServiceZonesRouter } from "../src/modules/geography/service-zones.routes.js";
import { createCustodyRouter } from "../src/modules/custody/custody.routes.js";
import { createPartnerExecutionRouter } from "../src/modules/partner-execution/partner-execution.routes.js";
import { createOperationalCasesRouter } from "../src/modules/operational-cases/operational-cases.routes.js";
import { createPartnerSettlementRouter } from "../src/modules/partner-settlement/partner-settlement.routes.js";

const authMiddleware = (req, res, next) => {
  const role = req.get("x-test-role");
  if (!role) return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED" } });
  req.user = { id: "authorization-test-user", role };
  return next();
};
const roleMiddleware = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  return next();
};

function createAuthorizationApp() {
  const app = express();
  app.use(express.json());
  const dependencies = { prismaClient: {}, authMiddleware, roleMiddleware };

  app.use("/support", createSupportRouter(dependencies));
  app.use("/finance", createFinanceRouter(dependencies));
  app.use("/geography/admin", createGeographyAdminRouter(dependencies));
  app.use("/service-zones", createServiceZonesRouter(dependencies));
  app.use("/", createCustodyRouter(dependencies));
  app.use("/", createPartnerExecutionRouter(dependencies));
  app.use("/", createOperationalCasesRouter(dependencies));
  app.use("/", createPartnerSettlementRouter(dependencies));
  return app;
}

const protectedRoutes = [
  ["support queue", "GET", "/support/admin/tickets"],
  ["support ticket mutation", "PATCH", "/support/admin/tickets/ticket-1"],
  ["refund review queue", "GET", "/finance/admin/refunds"],
  ["refund review mutation", "PATCH", "/finance/admin/refunds/refund-1"],
  ["finance reconciliation", "GET", "/finance/admin/reconciliation"],
  ["country administration", "GET", "/geography/admin/countries"],
  ["service-zone administration", "GET", "/service-zones/admin"],
  ["recipient phone verification", "PATCH", "/admin/users/user-1/phone-verification"],
  ["hub operator administration", "POST", "/admin/hub-points/hub-1/operators"],
  ["partner membership administration", "POST", "/admin/transport-partners/partner-1/members"],
  ["partner assignment administration", "POST", "/admin/delivery-legs/leg-1/partner-assignment"],
  ["operational case queue", "GET", "/admin/operational-cases"],
  ["partner payable administration", "GET", "/admin/partner-payables"],
  ["partner settlement batches", "GET", "/admin/partner-settlement-batches"],
];

test("administrative routes reject unauthenticated requests before invoking handlers", async () => {
  const app = createAuthorizationApp();
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, method, path] of protectedRoutes) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 401, `${name} must require authentication`);
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("administrative routes reject CUSTOMER access before validation or service execution", async () => {
  const app = createAuthorizationApp();
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, method, path] of protectedRoutes) {
      const response = await fetch(base + path, {
        method,
        headers: { "x-test-role": "CUSTOMER", "content-type": "application/json" },
        body: ["PATCH", "POST", "PUT", "DELETE"].includes(method) ? "{}" : undefined,
      });
      assert.equal(response.status, 403, `${name} must reject CUSTOMER`);
      const body = await response.json();
      assert.equal(body.error.code, "FORBIDDEN", `${name} must use the standard role-denial response`);
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("SUPPORT access is limited to support operations and denied finance oversight", async () => {
  const app = createAuthorizationApp();
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    // The support queue remains available to SUPPORT. Finance records are restricted to ADMIN.
    for (const path of [
      "/support/admin/tickets",
    ]) {
      const response = await fetch(base + path, { headers: { "x-test-role": "SUPPORT" } });
      assert.notEqual(response.status, 403, `SUPPORT route grant unexpectedly removed: ${path}`);
    }

    const refundsDenied = await fetch(base + "/finance/admin/refunds", { headers: { "x-test-role": "SUPPORT" } });
    assert.equal(refundsDenied.status, 403);

    const reconciliationDenied = await fetch(base + "/finance/admin/reconciliation", { headers: { "x-test-role": "SUPPORT" } });
    assert.equal(reconciliationDenied.status, 403);

    const geographyDenied = await fetch(base + "/geography/admin/countries", { headers: { "x-test-role": "SUPPORT" } });
    assert.equal(geographyDenied.status, 403);

    const partnerSettlementDenied = await fetch(base + "/admin/partner-payables", { headers: { "x-test-role": "SUPPORT" } });
    assert.equal(partnerSettlementDenied.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

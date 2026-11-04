import test from "node:test";
import assert from "node:assert/strict";
import { createFinanceRouter } from "../src/modules/finance/finance.routes.js";

test("finance oversight is ADMIN-only and exposes no payout mutation routes", () => {
  const authMiddleware = (_req, _res, next) => next();
  const roleMiddleware = (...roles) => {
    const middleware = (_req, _res, next) => next();
    middleware.requiredRoles = roles;
    return middleware;
  };

  const router = createFinanceRouter({
    prismaClient: {},
    authMiddleware,
    roleMiddleware,
  });

  const routes = router.stack
    .filter(layer => layer.route)
    .map(layer => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      requiredRoles: layer.route.stack.find(item => item.handle.requiredRoles)?.handle.requiredRoles ?? [],
    }));

  const refundList = routes.find(route => route.path === "/admin/refunds" && route.methods.includes("get"));
  const reconciliation = routes.find(route => route.path === "/admin/reconciliation" && route.methods.includes("get"));

  assert.deepEqual(refundList?.requiredRoles, ["ADMIN"]);
  assert.deepEqual(reconciliation?.requiredRoles, ["ADMIN"]);
  assert.equal(routes.some(route => route.path.startsWith("/admin/payouts")), false);
});

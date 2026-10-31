import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulesRoot = join(repositoryRoot, "src", "modules");

const inventoriedAdminRouteFiles = [
  "src/modules/audit/audit.routes.js",
  "src/modules/custody/custody.routes.js",
  "src/modules/discovery/discovery.routes.js",
  "src/modules/drivers/drivers.admin.routes.js",
  "src/modules/drivers/drivers.routes.js",
  "src/modules/finance/finance.routes.js",
  "src/modules/geography/geography.admin.routes.js",
  "src/modules/geography/service-zones.routes.js",
  "src/modules/hub-points/hub-points.routes.js",
  "src/modules/operational-cases/operational-cases.routes.js",
  "src/modules/operations-control/operations-control.routes.js",
  "src/modules/partner-execution/partner-execution.routes.js",
  "src/modules/partner-pricing/partner-pricing.admin.routes.js",
  "src/modules/partner-pricing/partner-pricing.routes.js",
  "src/modules/partner-settlement/partner-settlement.routes.js",
  "src/modules/payments/financial.routes.js",
  "src/modules/support/support.routes.js",
].sort();

function collectRouteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".routes.js") ? [absolutePath] : [];
  });
}

function declaresAdministrativeAccess(source) {
  const hasAdminPath = /["'`]\/admin(?:\/|["'`])/.test(source);
  const hasAdminRole = /(?:requireRole|roleMiddleware)\s*\(\s*["'`]ADMIN["'`]|adminMiddleware\s*=\s*requireRole\s*\(\s*["'`]ADMIN["'`]/.test(source);
  return hasAdminPath || hasAdminRole;
}

test("all route modules declaring administrative access are represented in the permission inventory", () => {
  const discovered = collectRouteFiles(modulesRoot)
    .filter((absolutePath) => declaresAdministrativeAccess(readFileSync(absolutePath, "utf8")))
    .map((absolutePath) => relative(repositoryRoot, absolutePath).replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(discovered, inventoriedAdminRouteFiles);
});

test("every inventoried administrative route module declares authentication and a role guard", () => {
  for (const path of inventoriedAdminRouteFiles) {
    const source = readFileSync(join(repositoryRoot, path), "utf8");
    assert.match(source, /requireAuth|authMiddleware/, `${path} must declare an authentication guard`);
    assert.match(source, /requireRole|roleMiddleware|adminMiddleware|requireAdmin/, `${path} must declare a role guard`);
  }
});

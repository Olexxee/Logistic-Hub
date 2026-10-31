import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";

const root = fileURLToPath(new URL("../", import.meta.url));
const appPath = path.join(root, "src/app.js");
const appSource = await fs.readFile(appPath, "utf8");
const specPath = path.join(root, "docs/openapi.yaml");

function joinRoute(prefix, route) {
  const joined = `/${[prefix, route].filter(Boolean).join("/")}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : "/";
}
function normalizePath(value) {
  return value.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/+/g, "/");
}
function importedModules(source, baseDirectory) {
  const result = new Map();
  const expression = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(expression)) {
    const target = path.resolve(baseDirectory, match[2]);
    for (const name of match[1].split(",").map(value => value.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      result.set(name, target);
    }
  }
  return result;
}
function routeDeclarations(source) {
  const routes = [];
  const expression = /(?:router|r)\.(get|post|put|patch|delete|head|options)\s*\(\s*(\[[^\]]*\]|["'`][^"'`]*["'`])/g;
  for (const match of source.matchAll(expression)) {
    const method = match[1].toUpperCase();
    const firstArgument = match[2];
    const strings = [...firstArgument.matchAll(/["'`]([^"'`]+)["'`]/g)].map(item => item[1]);
    for (const route of strings) routes.push({ method, route });
  }
  return routes;
}

const appImports = importedModules(appSource, path.dirname(appPath));
const mounted = [];
const mountExpression = /app\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
for (const match of appSource.matchAll(mountExpression)) {
  const modulePath = appImports.get(match[2]);
  if (modulePath) mounted.push({ modulePath, prefix: match[1] });
}

const actual = new Set();
const visited = new Set();
async function scanModule(modulePath, prefix) {
  const visitKey = `${modulePath}::${prefix}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);
  const source = await fs.readFile(modulePath, "utf8");
  for (const { method, route } of routeDeclarations(source)) {
    const fullPath = normalizePath(joinRoute(prefix, route));
    actual.add(`${method} ${fullPath.startsWith("/api/v1/") ? fullPath.slice("/api/v1".length) : fullPath === "/api/v1" ? "/" : fullPath}`);
  }
  const imports = importedModules(source, path.dirname(modulePath));
  const nested = /(?:router|r)\.use\(\s*["']([^"']+)["']\s*,\s*(?:\w+\s*,\s*)?(\w+)\s*\(/g;
  for (const match of source.matchAll(nested)) {
    const nestedModule = imports.get(match[2]);
    if (nestedModule) await scanModule(nestedModule, joinRoute(prefix, match[1]));
  }
}
for (const entry of mounted) await scanModule(entry.modulePath, entry.prefix);

const api = await SwaggerParser.validate(specPath);
const supportSpecPath = path.join(root, "src/modules/support/support.openapi.yaml");
const supportApi = await SwaggerParser.validate(supportSpecPath);
const documented = new Set();
for (const [route, pathItem] of Object.entries({ ...(api.paths ?? {}), ...(supportApi.paths ?? {}) })) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (["get", "post", "put", "patch", "delete", "head", "options"].includes(method.toLowerCase())) {
      documented.add(`${method.toUpperCase()} ${normalizePath(route)}`);
    }
  }
}
const missing = [...actual].filter(route => !documented.has(route)).sort();
const invalidStatuses = [...actual].filter(route => {
  const split = route.indexOf(" ");
  const method = route.slice(0, split).toLowerCase();
  const routePath = route.slice(split + 1);
  const status = api.paths?.[routePath]?.[method]?.["x-implementation-status"];
  return !["implemented", "planned-disabled"].includes(status);
}).sort();
if (missing.length || invalidStatuses.length) {
  if (missing.length) {
    console.error("Mounted Express routes missing from OpenAPI:");
    for (const route of missing) console.error(` - ${route}`);
  }
  if (invalidStatuses.length) {
    console.error("Mounted Express routes must be marked implemented or planned-disabled:");
    for (const route of invalidStatuses) console.error(` - ${route}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Route/OpenAPI parity passed: ${actual.size} mounted Express operations are documented and have an explicit implementation status.`);
}

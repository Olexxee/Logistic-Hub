import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHubPointsRouter } from "../src/modules/hub-points/hub-points.routes.js";

async function requestAs(role) {
  const app = express();
  app.use(express.json());
  app.use("/hub-points", createHubPointsRouter({
    prismaClient: { hubPoint: { findMany: async () => [] } },
    authMiddleware: (req, _res, next) => { req.user = { id: "user-1", role }; next(); },
    roleMiddleware: expected => (req, res, next) => req.user.role === expected ? next() : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/hub-points/admin`);
    return { status: response.status, body: await response.json() };
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("hub administration is restricted to ADMIN", async () => {
  assert.equal((await requestAs("CUSTOMER")).status, 403);
  const admin = await requestAs("ADMIN");
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body.data.items, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createDriversRouter } from "../src/modules/drivers/drivers.routes.js";

async function withServer(role, run) {
  const prismaClient = {
    driverProfile: {
      findMany: async () => [{ id: "driver-1", verificationStatus: "PENDING" }],
      count: async () => 1,
    },
    vehicle: { findMany: async () => [], count: async () => 0 },
  };
  const authMiddleware = (req, _res, next) => { req.user = { id: "user-1", role }; next(); };
  const roleMiddleware = expected => (req, res, next) => {
    if (req.user?.role !== expected) return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
    return next();
  };
  const app = express();
  app.use(express.json());
  app.use("/drivers", createDriversRouter({ prismaClient, authMiddleware, roleMiddleware, email: { configured: false } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("driver admin queue is restricted to ADMIN and returns paginated profiles", async () => {
  await withServer("ADMIN", async base => {
    const response = await fetch(`${base}/drivers/admin/drivers?verificationStatus=PENDING&page=1&limit=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].id, "driver-1");
    assert.equal(body.data.total, 1);
  });
  await withServer("DRIVER", async base => {
    const response = await fetch(`${base}/drivers/admin/drivers`);
    assert.equal(response.status, 403);
  });
});

test("vehicle admin queue is restricted to ADMIN", async () => {
  await withServer("ADMIN", async base => {
    const response = await fetch(`${base}/drivers/admin/vehicles?isActive=false`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.items, []);
  });
  await withServer("CUSTOMER", async base => {
    const response = await fetch(`${base}/drivers/admin/vehicles`);
    assert.equal(response.status, 403);
  });
});

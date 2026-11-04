import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCustodyRouter } from "../src/modules/custody/custody.routes.js";

async function serve(role, prismaClient, run) {
  const app = express();
  app.use("/api/v1", createCustodyRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => { req.user = { id: "user-1", role }; next(); },
    roleMiddleware: expected => (req, res, next) => req.user.role === expected
      ? next()
      : res.status(403).json({ success: false, error: { code: "FORBIDDEN" } }),
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("ADMIN custody queue is paginated, filterable and excludes evidence payloads", async () => {
  let received;
  const prismaClient = {
    custodyHandover: { findMany: async args => {
      received = args;
      return [{ id: "handover-1", status: "PENDING_CONFIRMATION", parcelBooking: { publicReference: "LH-PCL-001" } }];
    } },
  };
  await serve("ADMIN", prismaClient, async base => {
    const params = new URLSearchParams({ status: "PENDING_CONFIRMATION", q: "LH-PCL", limit: "10" });
    const response = await fetch(`${base}/api/v1/admin/custody-handovers?${params}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].id, "handover-1");
    assert.equal(body.data.nextCursor, null);
    assert.equal(received.where.status, "PENDING_CONFIRMATION");
    assert.equal(received.where.parcelBooking.publicReference.contains, "LH-PCL");
    assert.equal(received.take, 11);
    assert.equal(received.select.evidence, undefined);
  });
});

test("ADMIN hub intake queue filters by hub and booking reference without evidence", async () => {
  let received;
  const prismaClient = {
    hubIntakeRecord: { findMany: async args => {
      received = args;
      return [{ id: "intake-1", status: "EXCEPTION", parcelBooking: { publicReference: "LH-PCL-002" } }];
    } },
  };
  await serve("ADMIN", prismaClient, async base => {
    const params = new URLSearchParams({ status: "EXCEPTION", hubPointId: "hub-1", q: "LH-PCL", limit: "5" });
    const response = await fetch(`${base}/api/v1/admin/hub-intakes?${params}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].id, "intake-1");
    assert.equal(received.where.status, "EXCEPTION");
    assert.equal(received.where.hubPointId, "hub-1");
    assert.equal(received.select.evidence, undefined);
    assert.equal(received.take, 6);
  });
});

test("non-ADMIN callers cannot access platform-wide custody or intake queues", async () => {
  let queried = false;
  const prismaClient = {
    custodyHandover: { findMany: async () => { queried = true; return []; } },
    hubIntakeRecord: { findMany: async () => { queried = true; return []; } },
  };
  await serve("SUPPORT", prismaClient, async base => {
    const handovers = await fetch(`${base}/api/v1/admin/custody-handovers`);
    const intakes = await fetch(`${base}/api/v1/admin/hub-intakes`);
    assert.equal(handovers.status, 403);
    assert.equal(intakes.status, 403);
    assert.equal(queried, false);
  });
});

test("admin read queues reject invalid query filters", async () => {
  const prismaClient = {
    custodyHandover: { findMany: async () => [] },
    hubIntakeRecord: { findMany: async () => [] },
  };
  await serve("ADMIN", prismaClient, async base => {
    const invalidStatus = await fetch(`${base}/api/v1/admin/custody-handovers?status=UNKNOWN`);
    const shortSearch = await fetch(`${base}/api/v1/admin/hub-intakes?q=x`);
    assert.equal(invalidStatus.status, 400);
    assert.equal(shortSearch.status, 400);
  });
});

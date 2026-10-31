import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createOperationalCasesRouter } from "../src/modules/operational-cases/operational-cases.routes.js";

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function createApp() {
  let received;
  const prismaClient = {
    operationalCase: {
      findMany: async args => {
        received = args;
        return [{
          id: "case-1",
          publicReference: "CASE-001",
          type: "FAILED_DELIVERY",
          status: "OPEN",
          priority: "HIGH",
          title: "Delivery failed",
          description: "Recipient unavailable",
          createdAt: new Date("2026-10-31T10:00:00.000Z"),
        }];
      },
    },
  };
  const app = express();
  app.use("/api/v1", createOperationalCasesRouter({
    prismaClient,
    authMiddleware: (_req, _res, next) => next(),
    roleMiddleware: () => (_req, _res, next) => next(),
  }));
  return { app, getReceived: () => received };
}

test("operational case queue accepts supported filters and returns case summaries", async () => {
  const { app, getReceived } = createApp();
  await withServer(app, async base => {
    const params = new URLSearchParams({
      q: "CASE-001",
      unassignedOnly: "true",
      createdFrom: "2026-10-01T00:00:00.000Z",
      createdTo: "2026-10-31T23:59:59.999Z",
      limit: "10",
    });
    const response = await fetch(`${base}/api/v1/admin/operational-cases?${params}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.items[0].publicReference, "CASE-001");
    assert.equal(body.data.items[0].evidence, undefined);
    assert.equal(getReceived().where.assignedToUserId, null);
    assert.equal(getReceived().where.OR[0].publicReference.contains, "CASE-001");
    assert.equal(getReceived().take, 11);
  });
});

test("operational case queue rejects conflicting assignee filters and inverted date ranges", async () => {
  const { app, getReceived } = createApp();
  await withServer(app, async base => {
    const conflicting = await fetch(`${base}/api/v1/admin/operational-cases?assignedToUserId=user-1&unassignedOnly=true`);
    assert.equal(conflicting.status, 400);
    const inverted = await fetch(`${base}/api/v1/admin/operational-cases?createdFrom=2026-10-31T00:00:00.000Z&createdTo=2026-10-01T00:00:00.000Z`);
    assert.equal(inverted.status, 400);
    assert.equal(getReceived(), undefined);
  });
});


test("operational case queue remains behind authenticated ADMIN authorization", async () => {
  let authCalls = 0;
  let queried = false;
  const requestedRoles = [];
  const app = express();
  app.use("/api/v1", createOperationalCasesRouter({
    prismaClient: { operationalCase: { findMany: async () => { queried = true; return []; } } },
    authMiddleware: (_req, _res, next) => { authCalls += 1; next(); },
    roleMiddleware: role => {
      requestedRoles.push(role);
      return (_req, res) => res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
    },
  }));
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/operational-cases`);
    assert.equal(response.status, 403);
    assert.equal(authCalls, 1);
    assert.deepEqual(requestedRoles, ["ADMIN"]);
    assert.equal(queried, false);
  });
});

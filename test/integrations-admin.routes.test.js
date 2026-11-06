import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIntegrationsAdminRouter } from "../src/modules/integrations/integrations-admin.routes.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function setup() {
  const state = { clients: [], audits: [] };
  const tx = {
    integrationClient: {
      findMany: async () => state.clients,
      count: async () => state.clients.length,
      create: async ({ data }) => {
        const client = { id: "client_1", status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(), ...data };
        state.clients.push(client);
        return client;
      },
      findUnique: async ({ where }) => state.clients.find(client => client.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const client = state.clients.find(item => item.id === where.id);
        Object.assign(client, data);
        return client;
      },
    },
    integrationCredential: {
      create: async ({ data }) => ({ id: "credential_1", status: "ACTIVE", createdAt: new Date(), ...data }),
      findUnique: async () => null,
      update: async () => ({}),
    },
    integrationBillingAgreement: {
      aggregate: async () => ({ _max: { version: null } }),
      create: async ({ data }) => ({ id: "agreement_1", currency: "NGN", status: "DRAFT", ...data }),
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
  };
  const prismaClient = { ...tx, $transaction: work => work(tx) };
  const app = express();
  app.use(express.json());
  const authMiddleware = (req, _res, next) => {
    req.user = { id: "admin_1", role: req.get("x-role") ?? "CUSTOMER" };
    next();
  };
  app.use("/api/v1/admin/integrations", createIntegrationsAdminRouter({
    prismaClient, authMiddleware,
  }));
  app.use(errorHandler);
  return { app, state };
}

test("integration administration rejects non-admin callers", async () => {
  const { app, state } = setup();
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/integrations`, {
      headers: { "x-role": "SUPPORT" },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(state.audits, []);
  });
});

test("admin client registration validates input and writes an audit event", async () => {
  const { app, state } = setup();
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/integrations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-role": "ADMIN" },
      body: JSON.stringify({
        code: "market_iq", name: "MarketIQ", scopes: ["quotes:write"],
        reason: "Register MarketIQ integration",
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.data.code, "market_iq");
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].action, "INTEGRATION_CLIENT_CREATED");
    assert.equal(state.audits[0].reason, "Register MarketIQ integration");
  });
});

test("client registration rejects missing audit reason", async () => {
  const { app, state } = setup();
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/integrations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-role": "ADMIN" },
      body: JSON.stringify({ code: "market_iq", name: "MarketIQ" }),
    });
    assert.equal(response.status, 400);
    assert.equal(state.clients.length, 0);
    assert.equal(state.audits.length, 0);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createIntegrationWebhookRouter } from "../src/modules/integrations/integration-webhook.routes.js";

async function withServer(app, work) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("webhook management routes require the webhooks:manage scope", async () => {
  const prismaClient = {
    integrationWebhookEndpoint: {
      findMany: async ({ where }) => where.clientId === "client-1" ? [] : [],
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1/integrations", createIntegrationWebhookRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => {
      req.integrationClient = { id: "client-1", credentialId: "credential-1", scopes: [] };
      next();
    },
  }));

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/integrations/webhooks`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "INTEGRATION_SCOPE_FORBIDDEN");
  });
});

test("webhook management routes return only the authenticated client's endpoint list", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/integrations", createIntegrationWebhookRouter({
    prismaClient: {
      integrationWebhookEndpoint: {
        findMany: async ({ where }) => {
          assert.equal(where.clientId, "client-1");
          return [{
            id: "endpoint-1", url: "https://hooks.example.org", description: null,
            eventTypes: ["shipment.created"], status: "ACTIVE", currentSecretVersion: 1,
            revokedAt: null, createdAt: new Date(), updatedAt: new Date(),
          }];
        },
      },
    },
    authMiddleware: (req, _res, next) => {
      req.integrationClient = { id: "client-1", credentialId: "credential-1", scopes: ["webhooks:manage"] };
      next();
    },
  }));

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/integrations/webhooks`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].id, "endpoint-1");
    assert.equal(body.data.items[0].secretVersion, 1);
    assert.equal("encryptedValue" in body.data.items[0], false);
  });
});


test("delivery telemetry requires webhooks:read independently of endpoint management", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/integrations", createIntegrationWebhookRouter({
    prismaClient: {
      integrationWebhookDelivery: {
        findMany: async ({ where }) => {
          assert.equal(where.endpoint.clientId, "client-1");
          return [];
        },
        count: async () => 0,
      },
    },
    authMiddleware: (req, _res, next) => {
      req.integrationClient = { id: "client-1", credentialId: "credential-1", scopes: ["webhooks:read"] };
      next();
    },
  }));

  await withServer(app, async baseUrl => {
    const telemetry = await fetch(`${baseUrl}/api/v1/integrations/webhooks/deliveries`);
    assert.equal(telemetry.status, 200);
    const body = await telemetry.json();
    assert.deepEqual(body.data.items, []);

    const management = await fetch(`${baseUrl}/api/v1/integrations/webhooks`);
    assert.equal(management.status, 403);
  });
});

test("replay route requires webhooks:manage and validates bounded selectors", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/integrations", createIntegrationWebhookRouter({
    prismaClient: {},
    authMiddleware: (req, _res, next) => {
      req.integrationClient = { id: "client-1", credentialId: "credential-1", scopes: ["webhooks:read"] };
      next();
    },
  }));

  await withServer(app, async baseUrl => {
    const denied = await fetch(`${baseUrl}/api/v1/integrations/webhooks/endpoint-1/replay`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "event-1" }),
    });
    assert.equal(denied.status, 403);
  });
});

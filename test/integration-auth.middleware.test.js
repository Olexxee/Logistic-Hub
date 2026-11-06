import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createIntegrationAuthMiddleware, createIntegrationCredentialMaterial } from "../src/modules/integrations/integration-auth.middleware.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(headers = {}) {
  return { get(name) { return headers[name.toLowerCase()] ?? undefined; } };
}

function fixture(overrides = {}) {
  const secret = "lhs_test_secret";
  const credential = {
    id: "cred_1", clientId: "client_1",
    secretHash: createHash("sha256").update(secret).digest("hex"),
    status: "ACTIVE", expiresAt: null, lastUsedAt: new Date(),
    client: { id: "client_1", code: "market_iq", name: "MarketIQ", status: "ACTIVE", scopes: ["quotes:write", "shipments:read"] },
    ...overrides,
  };
  const prismaClient = {
    integrationCredential: {
      findUnique: async () => credential,
      update: async () => ({ ...credential }),
    },
  };
  return { secret, credential, prismaClient };
}

test("integration authentication attaches client identity from the credential record", async () => {
  const { secret, prismaClient } = fixture();
  const middleware = createIntegrationAuthMiddleware({ prismaClient });
  const req = request({ "x-integration-key-id": "key_1", "x-integration-secret": secret });
  const res = response();
  let nextCalled = false;
  await middleware.requireIntegrationAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.integrationClient, {
    id: "client_1", code: "market_iq", name: "MarketIQ",
    scopes: ["quotes:write", "shipments:read"], credentialId: "cred_1",
  });
});

test("missing credentials are rejected", async () => {
  const { prismaClient } = fixture();
  const middleware = createIntegrationAuthMiddleware({ prismaClient });
  const res = response();
  await middleware.requireIntegrationAuth(request(), res, () => assert.fail("next must not run"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, "INTEGRATION_UNAUTHORIZED");
});

test("incorrect secret, revoked credential and suspended client are rejected", async () => {
  for (const override of [
    { secretHash: "0".repeat(64) },
    { status: "REVOKED" },
    { client: { id: "client_1", code: "market_iq", name: "MarketIQ", status: "SUSPENDED", scopes: [] } },
  ]) {
    const { prismaClient } = fixture(override);
    const middleware = createIntegrationAuthMiddleware({ prismaClient });
    const res = response();
    await middleware.requireIntegrationAuth(
      request({ "x-integration-key-id": "key_1", "x-integration-secret": "lhs_test_secret" }),
      res,
      () => assert.fail("next must not run"),
    );
    assert.equal(res.statusCode, 401);
  }
});

test("expired credentials are rejected", async () => {
  const { prismaClient } = fixture({ expiresAt: new Date("2020-01-01T00:00:00.000Z") });
  const middleware = createIntegrationAuthMiddleware({ prismaClient, clock: () => new Date("2026-01-01T00:00:00.000Z") });
  const res = response();
  await middleware.requireIntegrationAuth(
    request({ "x-integration-key-id": "key_1", "x-integration-secret": "lhs_test_secret" }),
    res,
    () => assert.fail("next must not run"),
  );
  assert.equal(res.statusCode, 401);
});

test("scope middleware requires every requested scope", () => {
  const middleware = createIntegrationAuthMiddleware({ prismaClient: {} });
  const req = { integrationClient: { scopes: ["quotes:write"] } };
  const res = response();
  let called = false;
  middleware.requireIntegrationScope("quotes:write")(req, res, () => { called = true; });
  assert.equal(called, true);
  const denied = response();
  middleware.requireIntegrationScope("quotes:write", "shipments:write")(req, denied, () => assert.fail("next must not run"));
  assert.equal(denied.statusCode, 403);
});

test("credential material is one-way hashed and high entropy", () => {
  const material = createIntegrationCredentialMaterial();
  assert.match(material.keyId, /^lhk_[a-f0-9]{24}$/);
  assert.match(material.secret, /^lhs_[a-f0-9]{64}$/);
  assert.equal(material.secretHash, createHash("sha256").update(material.secret).digest("hex"));
  assert.notEqual(material.secretHash, material.secret);
});

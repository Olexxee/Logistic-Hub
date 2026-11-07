import test from "node:test";
import assert from "node:assert/strict";
import {
  createWebhookSigningSecret,
  decryptWebhookSecret,
  encryptWebhookSecret,
  isPublicAddress,
  validateWebhookEndpointUrl,
} from "../src/modules/integrations/integration-webhook.security.js";
import { createIntegrationWebhookService } from "../src/modules/integrations/integration-webhook.service.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("webhook URL validation requires HTTPS, canonical public DNS and port 443", async () => {
  const normalized = await validateWebhookEndpointUrl("https://hooks.example.org/events", { lookup: publicLookup });
  assert.equal(normalized, "https://hooks.example.org/events");

  for (const url of [
    "http://hooks.example.org/events",
    "https://user:pass@hooks.example.org/events",
    "https://hooks.example.org/events?token=secret",
    "https://hooks.example.org/events#fragment",
    "https://hooks.example.org:8443/events",
    "https://127.0.0.1/events",
    "https://localhost/events",
    "https://service.internal/events",
  ]) {
    await assert.rejects(validateWebhookEndpointUrl(url, { lookup: publicLookup }));
  }
});

test("webhook URL validation rejects DNS answers containing any non-public address", async () => {
  await assert.rejects(
    validateWebhookEndpointUrl("https://rebound.example.org/hook", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
    }),
    /exclusively to public IP addresses/,
  );
  await assert.rejects(
    validateWebhookEndpointUrl("https://unresolved.example.org/hook", { lookup: async () => [] }),
    /resolve to public IP addresses/,
  );
});

test("public-address classifier blocks private, loopback, link-local, reserved and multicast ranges", () => {
  for (const address of ["10.1.2.3", "127.0.0.1", "169.254.10.20", "172.16.0.1", "192.168.1.1", "100.64.0.1", "224.0.0.1", "240.0.0.1", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("webhook secret encryption is authenticated and bound to endpoint and version", () => {
  const secret = createWebhookSigningSecret();
  const encrypted = encryptWebhookSecret(secret, { endpointId: "endpoint-1", version: 2, encryptionKey });
  const record = { endpointId: "endpoint-1", version: 2, ...encrypted };
  assert.equal(decryptWebhookSecret(record, { encryptionKey }), secret);
  assert.throws(() => decryptWebhookSecret({ ...record, endpointId: "endpoint-2" }, { encryptionKey }));
  assert.throws(() => decryptWebhookSecret(record, { encryptionKey: Buffer.alloc(32, 8).toString("base64") }));
});

function createPrismaFixture() {
  const state = { endpoint: null, secretVersions: [], audit: [], clientStatus: "ACTIVE" };
  let version = 0;
  const tx = {
    integrationClient: {
      findUnique: async () => ({ id: "client-1", status: state.clientStatus }),
    },
    integrationWebhookEndpoint: {
      create: async ({ data }) => {
        state.endpoint = {
          id: "endpoint-1", ...data, status: "ACTIVE", revokedAt: null,
          createdAt: new Date("2026-11-07T00:00:00.000Z"), updatedAt: new Date("2026-11-07T00:00:00.000Z"),
        };
        version = data.currentSecretVersion;
        return { ...state.endpoint };
      },
      findFirst: async ({ where }) => where.clientId === "client-1" && state.endpoint?.id === where.id
        ? { ...state.endpoint }
        : null,
      findMany: async ({ where }) => where.clientId === "client-1" && state.endpoint ? [{ ...state.endpoint }] : [],
      update: async ({ where, data }) => {
        assert.equal(where.id, "endpoint-1");
        state.endpoint = {
          ...state.endpoint,
          ...data,
          currentSecretVersion: data.currentSecretVersion?.increment
            ? (version += data.currentSecretVersion.increment)
            : state.endpoint.currentSecretVersion,
          updatedAt: new Date("2026-11-07T00:05:00.000Z"),
        };
        return { ...state.endpoint };
      },
    },
    integrationWebhookSecretVersion: {
      create: async ({ data }) => { state.secretVersions.push(data); return data; },
    },
    integrationWebhookAuditEvent: {
      create: async ({ data }) => { state.audit.push(data); return data; },
    },
  };
  const prismaClient = { $transaction: async work => work(tx), ...tx };
  return { state, prismaClient };
}

test("creating a webhook endpoint returns its secret once and stores only authenticated ciphertext", async () => {
  const { state, prismaClient } = createPrismaFixture();
  const service = createIntegrationWebhookService({ prismaClient, lookup: publicLookup, encryptionKey });
  const result = await service.createEndpoint({
    clientId: "client-1",
    credentialId: "credential-1",
    url: "https://hooks.example.org/notify",
    description: "MarketIQ shipment events",
    eventTypes: ["shipment.created", "shipment.in_transit"],
  });

  assert.equal(result.endpoint.id, "endpoint-1");
  assert.equal(result.endpoint.secretVersion, 1);
  assert.match(result.secret, /^lhwhsec_/);
  assert.equal(state.secretVersions.length, 1);
  assert.equal("secret" in state.secretVersions[0], false);
  assert.equal(decryptWebhookSecret({
    endpointId: "endpoint-1", version: 1, ...state.secretVersions[0],
  }, { encryptionKey }), result.secret);
  assert.equal(state.audit[0].action, "WEBHOOK_ENDPOINT_CREATED");
});

test("webhook endpoint listing is client-scoped and never exposes encrypted secret fields", async () => {
  const { prismaClient } = createPrismaFixture();
  const service = createIntegrationWebhookService({ prismaClient, lookup: publicLookup, encryptionKey });
  await service.createEndpoint({
    clientId: "client-1", credentialId: "credential-1",
    url: "https://hooks.example.org/notify", eventTypes: ["shipment.created"],
  });
  const owned = await service.listEndpoints({ clientId: "client-1", page: 1, limit: 10 });
  const foreign = await service.listEndpoints({ clientId: "client-2", page: 1, limit: 10 });
  assert.equal(owned.items.length, 1);
  assert.equal(owned.items[0].url, "https://hooks.example.org/notify");
  assert.equal("encryptedValue" in owned.items[0], false);
  assert.deepEqual(foreign.items, []);
  assert.deepEqual(foreign.pagination, { page: 1, limit: 10, hasMore: false, nextPage: null });
});

test("webhook endpoint updates enforce client isolation and terminal revocation", async () => {
  const { state, prismaClient } = createPrismaFixture();
  const service = createIntegrationWebhookService({ prismaClient, lookup: publicLookup, encryptionKey });
  await service.createEndpoint({
    clientId: "client-1", credentialId: "credential-1",
    url: "https://hooks.example.org/notify", eventTypes: ["shipment.created"],
  });

  await assert.rejects(
    service.updateEndpoint({ clientId: "another-client", endpointId: "endpoint-1", status: "SUSPENDED", reason: "Temporary pause" }),
    error => error.code === "INTEGRATION_WEBHOOK_ENDPOINT_NOT_FOUND",
  );
  await service.updateEndpoint({
    clientId: "client-1", credentialId: "credential-1", endpointId: "endpoint-1",
    status: "REVOKED", reason: "Endpoint is no longer trusted",
  });
  await assert.rejects(
    service.updateEndpoint({
      clientId: "client-1", credentialId: "credential-1", endpointId: "endpoint-1",
      status: "ACTIVE", reason: "Attempt reactivation",
    }),
    error => error.code === "INTEGRATION_WEBHOOK_ENDPOINT_REVOKED",
  );
  assert.equal(state.endpoint.status, "REVOKED");
});

test("secret rotation increments the version and retains prior encrypted versions", async () => {
  const { state, prismaClient } = createPrismaFixture();
  const service = createIntegrationWebhookService({ prismaClient, lookup: publicLookup, encryptionKey });
  const first = await service.createEndpoint({
    clientId: "client-1", credentialId: "credential-1",
    url: "https://hooks.example.org/notify", eventTypes: ["shipment.created"],
  });
  const second = await service.rotateSecret({
    clientId: "client-1", credentialId: "credential-1", endpointId: "endpoint-1",
    reason: "Scheduled key rotation",
  });

  assert.equal(first.endpoint.secretVersion, 1);
  assert.equal(second.endpoint.secretVersion, 2);
  assert.notEqual(first.secret, second.secret);
  assert.equal(state.secretVersions.length, 2);
  assert.equal(decryptWebhookSecret({
    endpointId: "endpoint-1", version: 1, ...state.secretVersions[0],
  }, { encryptionKey }), first.secret);
  assert.equal(decryptWebhookSecret({
    endpointId: "endpoint-1", version: 2, ...state.secretVersions[1],
  }, { encryptionKey }), second.secret);
});

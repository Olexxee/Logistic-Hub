import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationsAdminService } from "../src/modules/integrations/integrations-admin.service.js";

function makePrisma() {
  const state = { clients: [], credentials: [], agreements: [], audits: [] };
  const tx = {
    integrationClient: {
      findUnique: async ({ where }) => state.clients.find(item => item.id === where.id) ?? null,
      create: async ({ data }) => {
        const client = { id: `client_${state.clients.length + 1}`, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(), ...data };
        state.clients.push(client);
        return client;
      },
      update: async ({ where, data }) => {
        const client = state.clients.find(item => item.id === where.id);
        Object.assign(client, data, { updatedAt: new Date() });
        return client;
      },
      findMany: async () => state.clients,
      count: async () => state.clients.length,
    },
    integrationCredential: {
      create: async ({ data }) => {
        const credential = { id: `credential_${state.credentials.length + 1}`, status: "ACTIVE", createdAt: new Date(), ...data };
        state.credentials.push(credential);
        return credential;
      },
      findUnique: async ({ where }) => state.credentials.find(item => item.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const credential = state.credentials.find(item => item.id === where.id);
        Object.assign(credential, data);
        return credential;
      },
    },
    integrationBillingAgreement: {
      aggregate: async () => ({ _max: { version: state.agreements.at(-1)?.version ?? null } }),
      create: async ({ data }) => {
        const agreement = { id: `agreement_${state.agreements.length + 1}`, currency: "NGN", status: "DRAFT", createdAt: new Date(), ...data };
        state.agreements.push(agreement);
        return agreement;
      },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
  };
  return { state, prismaClient: { ...tx, $transaction: work => work(tx) } };
}

test("client creation is audited and returns no credential material", async () => {
  const { state, prismaClient } = makePrisma();
  const service = createIntegrationsAdminService({ prismaClient });
  const client = await service.createClient({
    code: "market_iq", name: "MarketIQ", scopes: ["quotes:write"], actorUserId: "admin_1",
  });
  assert.equal(client.code, "market_iq");
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, "INTEGRATION_CLIENT_CREATED");
  assert.equal(JSON.stringify(state.audits).includes("secret"), false);
});

test("credential issuance persists only a hash and returns the secret once", async () => {
  const { state, prismaClient } = makePrisma();
  const service = createIntegrationsAdminService({ prismaClient });
  const client = await service.createClient({ code: "market_iq", name: "MarketIQ", scopes: [], actorUserId: "admin_1" });
  const issued = await service.issueCredential({
    clientId: client.id, label: "Production key", reason: "Initial service credential", actorUserId: "admin_1",
  });
  assert.match(issued.secret, /^lhs_[a-f0-9]{64}$/);
  assert.notEqual(state.credentials[0].secretHash, issued.secret);
  assert.equal(state.credentials[0].secretHash.length, 64);
  assert.equal(JSON.stringify(state.audits).includes(issued.secret), false);
});

test("revoked clients cannot be reactivated", async () => {
  const { prismaClient } = makePrisma();
  const service = createIntegrationsAdminService({ prismaClient });
  const client = await service.createClient({ code: "market_iq", name: "MarketIQ", scopes: [], actorUserId: "admin_1" });
  await service.updateClientStatus({ clientId: client.id, status: "REVOKED", reason: "Client permanently retired", actorUserId: "admin_1" });
  await assert.rejects(
    service.updateClientStatus({ clientId: client.id, status: "ACTIVE", reason: "Attempted restore", actorUserId: "admin_1" }),
    error => error.code === "INTEGRATION_CLIENT_REVOKED",
  );
});

test("billing agreement versions increase within a client reference", async () => {
  const { state, prismaClient } = makePrisma();
  const service = createIntegrationsAdminService({ prismaClient, clock: () => new Date("2026-01-01T00:00:00.000Z") });
  const client = await service.createClient({ code: "market_iq", name: "MarketIQ", scopes: [], actorUserId: "admin_1" });
  const first = await service.createBillingAgreement({
    clientId: client.id, reference: "marketplace-default", billingModel: "PLATFORM_COLLECTED",
    reason: "Initial agreed billing model", actorUserId: "admin_1",
  });
  const second = await service.createBillingAgreement({
    clientId: client.id, reference: "marketplace-default", billingModel: "INVOICE",
    reason: "Revised commercial agreement", actorUserId: "admin_1",
  });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(state.agreements.length, 2);
});

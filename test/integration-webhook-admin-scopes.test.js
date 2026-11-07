import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationsAdminService } from "../src/modules/integrations/integrations-admin.service.js";

test("ADMIN scope updates are audited and can grant webhook management to an existing client", async () => {
  const state = {
    client: { id: "client-1", code: "marketiq", name: "MarketIQ", status: "ACTIVE", scopes: ["quotes:read", "quotes:write", "shipments:read", "shipments:write"] },
    audit: [],
  };
  const tx = {
    integrationClient: {
      findUnique: async () => ({ ...state.client }),
      update: async ({ data }) => { state.client = { ...state.client, ...data }; return { ...state.client }; },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audit.push(data); return data; },
    },
  };
  const prismaClient = { $transaction: async work => work(tx) };
  const service = createIntegrationsAdminService({ prismaClient });
  const result = await service.updateClientScopes({
    clientId: "client-1",
    scopes: [...state.client.scopes, "webhooks:manage"],
    reason: "Enable signed shipment event subscriptions",
    actorUserId: "admin-1",
  });

  assert.equal(result.client.scopes.includes("webhooks:manage"), true);
  assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0].action, "INTEGRATION_CLIENT_SCOPES_CHANGED");
  assert.deepEqual(state.audit[0].before.scopes, ["quotes:read", "quotes:write", "shipments:read", "shipments:write"]);
  assert.equal(state.audit[0].after.scopes.includes("webhooks:manage"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { writeOperationalAuditEvent } from "../src/shared/audit/operational-audit.js";

const event = { actorUserId: "admin-1", entityType: "HUB_POINT", entityId: "hub-1", action: "HUB_STATUS_UPDATED" };

test("operational audit writes through the supplied transaction client", async () => {
  let received;
  const tx = { operationalAuditEvent: { create: async args => { received = args; return { id: "event-1", ...args.data }; } } };
  const result = await writeOperationalAuditEvent(tx, { ...event, before: { status: "PENDING" }, after: { status: "ACTIVE" } });
  assert.equal(result.id, "event-1");
  assert.equal(received.data.actorUserId, "admin-1");
  assert.deepEqual(received.data.before, { status: "PENDING" });
  assert.deepEqual(received.data.after, { status: "ACTIVE" });
  assert.equal(received.data.reason, null);
});

test("operational audit rejects a root Prisma client", async () => {
  const root = { $transaction: async () => {}, operationalAuditEvent: { create: async () => ({}) } };
  await assert.rejects(writeOperationalAuditEvent(root, event), /interactive Prisma transaction client/);
});

test("operational audit rejects incomplete actor and entity context", async () => {
  const tx = { operationalAuditEvent: { create: async () => ({}) } };
  await assert.rejects(writeOperationalAuditEvent(tx, { ...event, actorUserId: "" }), /actorUserId is required/);
});

test("operational audit accepts explicit system events without fabricating a user", async () => {
  let received;
  const tx = { operationalAuditEvent: { create: async args => { received = args; return { id: "system-event-1", ...args.data }; } } };
  const result = await writeOperationalAuditEvent(tx, {
    actorType: "SYSTEM",
    systemSource: "PAYSTACK_REFUND_WEBHOOK",
    entityType: "REFUND_REQUEST",
    entityId: "refund-1",
    action: "REFUND_PROVIDER_WEBHOOK_STATUS_UPDATED",
    before: { status: "PROCESSING" },
    after: { status: "PROCESSED" },
    metadata: { providerEvent: "refund.processed" },
  });
  assert.equal(result.id, "system-event-1");
  assert.equal(received.data.actorUserId, null);
  assert.deepEqual(received.data.metadata, {
    providerEvent: "refund.processed",
    actorType: "SYSTEM",
    systemSource: "PAYSTACK_REFUND_WEBHOOK",
  });
});

test("operational audit rejects system events without an explicit source or with a human actor", async () => {
  const tx = { operationalAuditEvent: { create: async () => ({}) } };
  const base = {
    actorType: "SYSTEM",
    entityType: "REFUND_REQUEST",
    entityId: "refund-1",
    action: "REFUND_PROVIDER_WEBHOOK_STATUS_UPDATED",
  };
  await assert.rejects(writeOperationalAuditEvent(tx, base), /systemSource is required/);
  await assert.rejects(writeOperationalAuditEvent(tx, { ...base, systemSource: "PAYSTACK_REFUND_WEBHOOK", actorUserId: "admin-1" }), /cannot claim a human actor/);
});

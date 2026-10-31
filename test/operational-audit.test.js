import test from "node:test";
import assert from "node:assert/strict";
import { writeOperationalAuditEvent } from "../src/shared/audit/operational-audit.js";

test("operational audit writes through the supplied transaction client", async () => {
  let received;
  const tx = { operationalAuditEvent: { create: async args => { received = args; return { id: "event-1", ...args.data }; } } };
  const result = await writeOperationalAuditEvent(tx, {
    actorUserId: "admin-1",
    entityType: "HUB_POINT",
    entityId: "hub-1",
    action: "HUB_STATUS_UPDATED",
    before: { status: "PENDING" },
    after: { status: "ACTIVE" },
  });
  assert.equal(result.id, "event-1");
  assert.equal(received.data.actorUserId, "admin-1");
  assert.deepEqual(received.data.before, { status: "PENDING" });
  assert.deepEqual(received.data.after, { status: "ACTIVE" });
  assert.equal(received.data.reason, null);
});

test("operational audit rejects a root Prisma client instead of silently writing outside a transaction", async () => {
  await assert.rejects(
    writeOperationalAuditEvent({ operationalAuditEvent: { create: async () => ({}) } }, {
      actorUserId: "admin-1", entityType: "HUB_POINT", entityId: "hub-1", action: "HUB_STATUS_UPDATED",
    }),
    /transaction client/,
  );
});

test("operational audit rejects incomplete actor and entity context", async () => {
  const tx = { operationalAuditEvent: { create: async () => ({}) } };
  await assert.rejects(
    writeOperationalAuditEvent(tx, { actorUserId: "", entityType: "HUB_POINT", entityId: "hub-1", action: "HUB_STATUS_UPDATED" }),
    /actorUserId is required/,
  );
});

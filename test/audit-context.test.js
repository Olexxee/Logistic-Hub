import test from "node:test";
import assert from "node:assert/strict";
import { runWithAuditContext } from "../src/shared/audit/audit-context.js";
import { writeOperationalAuditEvent } from "../src/shared/audit/operational-audit.js";

test("audit writer attaches the active HTTP request ID to event metadata", async () => {
  let received;
  const tx = {
    operationalAuditEvent: {
      create: async ({ data }) => {
        received = data;
        return { id: "audit-request-1", ...data };
      },
    },
  };

  await runWithAuditContext({ requestId: "req-123" }, async () => {
    await Promise.resolve();
    await writeOperationalAuditEvent(tx, {
      actorUserId: "admin-1",
      entityType: "HUB_POINT",
      entityId: "hub-1",
      action: "HUB_STATUS_UPDATED",
    });
  });

  assert.equal(received.metadata.requestId, "req-123");
});

test("audit context does not leak request IDs between asynchronous requests", async () => {
  const observed = await Promise.all([
    runWithAuditContext({ requestId: "req-a" }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return (await import("../src/shared/audit/audit-context.js")).getAuditContext()?.requestId;
    }),
    runWithAuditContext({ requestId: "req-b" }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return (await import("../src/shared/audit/audit-context.js")).getAuditContext()?.requestId;
    }),
  ]);

  assert.deepEqual(observed.sort(), ["req-a", "req-b"]);
});

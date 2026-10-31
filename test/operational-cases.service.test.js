import test from "node:test";
import assert from "node:assert/strict";
import { createOperationalCasesService } from "../src/modules/operational-cases/operational-cases.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
function setup(initial = {}) {
  const current = {
    id: "case-1", status: "IN_PROGRESS", priority: "HIGH",
    assignedToUserId: null, resolution: null, ...initial,
  };
  const audits = [];
  const db = {
    operationalCase: {
      findUnique: async () => ({ ...current }),
      update: async ({ data }) => Object.assign(current, data),
      findMany: async () => [],
    },
    user: {
      findUnique: async ({ where }) => ({ id: where.id, role: "SUPPORT", status: "ACTIVE", emailVerifiedAt: now }),
    },
    operationalAuditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
    $transaction: async callback => callback(db),
  };
  return { db, current, audits };
}

test("operational case cannot skip the triage lifecycle", async () => {
  const { db } = setup({ status: "OPEN" });
  const service = createOperationalCasesService({ prismaClient: db, clock: () => now });
  await assert.rejects(service.update({ caseId: "case-1", actorUserId: "admin-1", status: "IN_PROGRESS" }), error => error.code === "INVALID_CASE_TRANSITION");
});

test("operational case cannot be resolved without a resolution summary", async () => {
  const { db } = setup();
  const service = createOperationalCasesService({ prismaClient: db, clock: () => now });
  await assert.rejects(service.update({ caseId: "case-1", actorUserId: "admin-1", status: "RESOLVED" }), error => error.code === "CASE_RESOLUTION_REQUIRED");
});

test("operational case resolves with a required resolution and writes an audit event", async () => {
  const { db, current, audits } = setup();
  const service = createOperationalCasesService({ prismaClient: db, clock: () => now });
  const result = await service.update({
    caseId: "case-1", actorUserId: "admin-1", status: "RESOLVED",
    resolution: "Parcel inspected and replacement packaging arranged.",
  });
  assert.equal(result.operationalCase.status, "RESOLVED");
  assert.equal(current.resolvedAt.toISOString(), now.toISOString());
  assert.equal(audits[0].action, "OPERATIONAL_CASE_UPDATED");
});

test("only active verified support or admin users can be assigned to a case", async () => {
  const { db } = setup();
  db.user.findUnique = async () => ({ id: "customer-1", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: now });
  const service = createOperationalCasesService({ prismaClient: db, clock: () => now });
  const result = await service.update({ caseId: "case-1", actorUserId: "admin-1", assignedToUserId: "customer-1" });
  assert.equal(result.blocker, "ASSIGNEE_INELIGIBLE");
});


test("operational case updates use serializable isolation", async () => {
  const { db } = setup();
  let options;
  const transaction = db.$transaction;
  db.$transaction = async (callback, transactionOptions) => {
    options = transactionOptions;
    return transaction(callback);
  };
  const service = createOperationalCasesService({ prismaClient: db, clock: () => now });
  await service.update({ caseId: "case-1", actorUserId: "admin-1", priority: "CRITICAL" });
  assert.deepEqual(options, { isolationLevel: "Serializable" });
});

test("operational case updates retry bounded Prisma serialization conflicts", async () => {
  const { db } = setup();
  let attempts = 0;
  const transaction = db.$transaction;
  db.$transaction = async (callback, options) => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("serialization conflict");
      error.code = "P2034";
      throw error;
    }
    return transaction(callback, options);
  };
  const service = createOperationalCasesService({ prismaClient: db, clock: () => now });
  const result = await service.update({ caseId: "case-1", actorUserId: "admin-1", priority: "CRITICAL" });
  assert.equal(result.operationalCase.priority, "CRITICAL");
  assert.equal(attempts, 3);
});

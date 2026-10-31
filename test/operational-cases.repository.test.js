import test from "node:test";
import assert from "node:assert/strict";
import { createOperationalCasesRepository } from "../src/modules/operational-cases/operational-cases.repository.js";

test("operational case queue applies search, assignment and date filters with explicit safe selection", async () => {
  let received;
  const prismaClient = {
    operationalCase: {
      findMany: async args => { received = args; return []; },
    },
  };
  const repository = createOperationalCasesRepository({ prismaClient });
  const createdFrom = new Date("2026-10-01T00:00:00.000Z");
  const createdTo = new Date("2026-10-31T23:59:59.999Z");
  await repository.list({
    status: "OPEN",
    type: "FAILED_DELIVERY",
    priority: "CRITICAL",
    q: "  LHub-123  ",
    unassignedOnly: true,
    createdFrom,
    createdTo,
    cursor: "case-cursor",
    limit: 20,
  });

  assert.deepEqual(received.where, {
    status: "OPEN",
    type: "FAILED_DELIVERY",
    priority: "CRITICAL",
    assignedToUserId: null,
    OR: [
      { publicReference: { contains: "LHub-123", mode: "insensitive" } },
      { title: { contains: "LHub-123", mode: "insensitive" } },
      { description: { contains: "LHub-123", mode: "insensitive" } },
    ],
    createdAt: { gte: createdFrom, lte: createdTo },
  });
  assert.deepEqual(received.cursor, { id: "case-cursor" });
  assert.equal(received.skip, 1);
  assert.equal(received.take, 21);
  assert.deepEqual(received.orderBy, [
    { priority: "desc" },
    { createdAt: "asc" },
    { id: "asc" },
  ]);
  assert.equal(received.select.evidence, undefined);
  assert.equal(received.select.title, true);
  assert.equal(received.select.reportedBy.select.fullName, true);
});

test("operational case queue supports assigned-to filtering without unassigned filter", async () => {
  let received;
  const repository = createOperationalCasesRepository({
    prismaClient: { operationalCase: { findMany: async args => { received = args; return []; } } },
  });
  await repository.list({ assignedToUserId: "support-user-1", limit: 10 });
  assert.equal(received.where.assignedToUserId, "support-user-1");
  assert.equal(received.take, 11);
  assert.equal(received.where.OR, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/modules/custody/custody.service.js";

function createPrisma({ hub = { id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" }, operator = { id: "operator-1", hubPointId: "hub-1", userId: "user-1", role: "MANAGER", isActive: true }, otherManagers = 1, user = { id: "user-1", status: "ACTIVE", emailVerifiedAt: new Date() } } = {}) {
  const state = { audits: [], updates: [] };
  const tx = {
    user: { findUnique: async () => user },
    hubPoint: { findUnique: async () => hub },
    hubPointOperator: {
      findFirst: async () => operator,
      count: async () => otherManagers,
      update: async ({ data }) => {
        state.updates.push(data);
        operator = { ...operator, ...data };
        return operator;
      },
      findMany: async () => [operator],
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
  };
  return {
    state,
    prismaClient: {
      hubPoint: { findUnique: async () => hub },
      hubPointOperator: {
        findMany: async () => [operator],
        count: async () => 1,
      },
      $transaction: async callback => callback(tx),
    },
  };
}

test("hub membership directory returns scoped members and pagination", async () => {
  const { prismaClient } = createPrisma();
  const service = createCustodyService({ prismaClient });
  const result = await service.listHubOperators({ hubPointId: "hub-1", page: 2, limit: 10, isActive: true });
  assert.equal(result.hub.id, "hub-1");
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 1, totalPages: 1 });
});

test("a manager cannot be demoted when they are the last active manager of an active hub", async () => {
  const { prismaClient, state } = createPrisma({ otherManagers: 0 });
  const service = createCustodyService({ prismaClient });
  const result = await service.updateHubOperatorRole({
    hubPointId: "hub-1", operatorId: "operator-1", role: "OPERATOR",
    reason: "Manager responsibilities reassigned", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "LAST_ACTIVE_HUB_MANAGER");
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.audits, []);
});

test("a hub operator role change is audited with actor, reason and before/after membership state", async () => {
  const { prismaClient, state } = createPrisma();
  const service = createCustodyService({ prismaClient });
  const result = await service.updateHubOperatorRole({
    hubPointId: "hub-1", operatorId: "operator-1", role: "OPERATOR",
    reason: "Manager responsibilities reassigned", actorUserId: "admin-1",
  });
  assert.equal(result.operator.role, "OPERATOR");
  assert.equal(state.audits[0].actorUserId, "admin-1");
  assert.equal(state.audits[0].reason, "Manager responsibilities reassigned");
  assert.deepEqual(state.audits[0].before, { role: "MANAGER", isActive: true });
  assert.deepEqual(state.audits[0].after, { role: "OPERATOR", isActive: true });
});

test("deactivating a hub membership records the administrative reason", async () => {
  const { prismaClient, state } = createPrisma({ otherManagers: 2 });
  const service = createCustodyService({ prismaClient });
  const result = await service.setHubOperatorStatus({
    hubPointId: "hub-1", operatorId: "operator-1", isActive: false,
    reason: "Operator left the organization", actorUserId: "admin-1",
  });
  assert.equal(result.operator.isActive, false);
  assert.equal(state.audits[0].reason, "Operator left the organization");
  assert.deepEqual(state.audits[0].before, { isActive: true });
  assert.deepEqual(state.audits[0].after, { isActive: false });
});


test("inactive or unverified users cannot be reactivated as hub operators", async () => {
  const { prismaClient, state } = createPrisma({
    operator: { id: "operator-1", hubPointId: "hub-1", userId: "user-1", role: "OPERATOR", isActive: false },
    user: { id: "user-1", status: "SUSPENDED", emailVerifiedAt: null },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.setHubOperatorStatus({
    hubPointId: "hub-1", operatorId: "operator-1", isActive: true,
    reason: "Attempted reactivation", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "USER_NOT_ACTIVE");
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.audits, []);
});

test("inactive or unverified users cannot be promoted to hub manager", async () => {
  const { prismaClient, state } = createPrisma({
    operator: { id: "operator-1", hubPointId: "hub-1", userId: "user-1", role: "OPERATOR", isActive: true },
    user: { id: "user-1", status: "ACTIVE", emailVerifiedAt: null },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.updateHubOperatorRole({
    hubPointId: "hub-1", operatorId: "operator-1", role: "MANAGER",
    reason: "Manager responsibilities assigned", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "USER_NOT_ACTIVE");
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.audits, []);
});

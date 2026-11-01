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


function createManagerStaffPrisma({
  hub = { id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" },
  managerMembership = { id: "manager-membership", hubPointId: "hub-1", userId: "manager-1", role: "MANAGER", isActive: true },
  targetUser = { id: "staff-1", status: "ACTIVE", emailVerifiedAt: new Date(), role: "CUSTOMER" },
  existingMembership = null,
} = {}) {
  const state = { audits: [], upserts: [], members: [] };
  const tx = {
    user: {
      findUnique: async ({ where }) => where.id === targetUser.id
        ? targetUser
        : { id: "manager-1", status: "ACTIVE", emailVerifiedAt: new Date(), role: "CUSTOMER" },
      update: async () => { throw new Error("Hub membership must not mutate global account roles."); },
    },
    hubPoint: { findUnique: async () => hub },
    hubPointOperator: {
      findUnique: async ({ where }) => {
        const key = where.hubPointId_userId;
        if (key.userId === "manager-1") {
          return managerMembership?.hubPointId === key.hubPointId ? managerMembership : null;
        }
        return existingMembership;
      },
      findMany: async () => state.members,
      count: async () => state.members.length,
      upsert: async ({ create }) => {
        const member = { id: "staff-membership", ...create };
        state.upserts.push(create);
        state.members.push(member);
        return member;
      },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
  };
  return {
    state,
    prismaClient: {
      hubPoint: tx.hubPoint,
      hubPointOperator: tx.hubPointOperator,
      $transaction: async callback => callback(tx),
    },
  };
}

test("a hub manager can list memberships only within their assigned hub", async () => {
  const { prismaClient, state } = createManagerStaffPrisma();
  state.members.push({ id: "staff-membership", role: "OPERATOR", isActive: true });
  const service = createCustodyService({ prismaClient });
  const result = await service.listHubOperatorsForManager({
    hubPointId: "hub-1", userId: "manager-1", page: 1, limit: 10,
  });
  assert.equal(result.hub.id, "hub-1");
  assert.equal(result.items.length, 1);
});

test("a user without an active MANAGER membership cannot list hub staff", async () => {
  const { prismaClient } = createManagerStaffPrisma({
    managerMembership: { role: "OPERATOR", isActive: true },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.listHubOperatorsForManager({
    hubPointId: "hub-1", userId: "manager-1",
  });
  assert.equal(result.forbidden, true);
});

test("a hub manager can add an active verified user as OPERATOR with an audit reason", async () => {
  const { prismaClient, state } = createManagerStaffPrisma();
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubStaff({
    hubPointId: "hub-1", userId: "staff-1",
    reason: "Staff member approved by hub manager", actorUserId: "manager-1",
  });
  assert.equal(result.operator.role, "OPERATOR");
  assert.equal(result.operator.isActive, true);
  assert.deepEqual(state.upserts, [{
    hubPointId: "hub-1", userId: "staff-1", role: "OPERATOR", isActive: true,
  }]);
  assert.equal(state.audits[0].actorUserId, "manager-1");
  assert.equal(state.audits[0].reason, "Staff member approved by hub manager");
  assert.deepEqual(state.audits[0].before, null);
  assert.deepEqual(state.audits[0].after, {
    hubPointId: "hub-1", userId: "staff-1", role: "OPERATOR", isActive: true,
  });
});

test("a hub manager cannot add themselves as staff", async () => {
  const { prismaClient, state } = createManagerStaffPrisma({
    targetUser: { id: "manager-1", status: "ACTIVE", emailVerifiedAt: new Date(), role: "CUSTOMER" },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubStaff({
    hubPointId: "hub-1", userId: "manager-1",
    reason: "Attempted self assignment", actorUserId: "manager-1",
  });
  assert.equal(result.blocker, "SELF_MEMBERSHIP_CHANGE");
  assert.deepEqual(state.upserts, []);
});

test("a hub manager cannot reactivate a membership previously deactivated by an administrator", async () => {
  const { prismaClient, state } = createManagerStaffPrisma({
    existingMembership: { id: "staff-membership", role: "OPERATOR", isActive: false },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubStaff({
    hubPointId: "hub-1", userId: "staff-1",
    reason: "Attempted membership restoration", actorUserId: "manager-1",
  });
  assert.equal(result.blocker, "ADMIN_REVIEW_REQUIRED");
  assert.deepEqual(state.upserts, []);
  assert.deepEqual(state.audits, []);
});

test("a hub manager cannot alter another manager membership", async () => {
  const { prismaClient, state } = createManagerStaffPrisma({
    existingMembership: { id: "other-manager", role: "MANAGER", isActive: true },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubStaff({
    hubPointId: "hub-1", userId: "staff-1",
    reason: "Attempted manager membership change", actorUserId: "manager-1",
  });
  assert.equal(result.blocker, "MANAGER_MEMBERSHIP_PROTECTED");
  assert.deepEqual(state.upserts, []);
});

test("a hub manager cannot add staff while the hub is suspended or closed", async () => {
  const { prismaClient, state } = createManagerStaffPrisma({
    hub: { id: "hub-1", name: "Ikeja Hub", status: "SUSPENDED" },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubStaff({
    hubPointId: "hub-1", userId: "staff-1",
    reason: "Attempted staff assignment", actorUserId: "manager-1",
  });
  assert.equal(result.blocker, "HUB_NOT_OPEN_FOR_STAFF");
  assert.deepEqual(state.upserts, []);
});


test("a manager membership for another hub does not grant access to this hub", async () => {
  const { prismaClient } = createManagerStaffPrisma({
    managerMembership: { id: "manager-membership", hubPointId: "hub-other", userId: "manager-1", role: "MANAGER", isActive: true },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.listHubOperatorsForManager({
    hubPointId: "hub-1", userId: "manager-1",
  });
  assert.equal(result.forbidden, true);
});

test("a manager cannot add staff to a different hub they do not manage", async () => {
  const { prismaClient, state } = createManagerStaffPrisma({
    managerMembership: { id: "manager-membership", hubPointId: "hub-other", userId: "manager-1", role: "MANAGER", isActive: true },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubStaff({
    hubPointId: "hub-1", userId: "staff-1",
    reason: "Attempted cross-hub staff assignment", actorUserId: "manager-1",
  });
  assert.equal(result.forbidden, true);
  assert.deepEqual(state.upserts, []);
  assert.deepEqual(state.audits, []);
});

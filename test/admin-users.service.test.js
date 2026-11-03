import test from "node:test";
import assert from "node:assert/strict";
import { createAdminUsersService } from "../src/modules/admin-users/admin-users.service.js";

const now = new Date("2026-11-01T12:00:00.000Z");

function makePrisma({ user, activeSessions = 2 } = {}) {
  const state = { user: user ?? {
    id: "user-1", fullName: "Test User", email: "user@example.test",
    role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: now,
  }, sessionCount: activeSessions, audits: [], updates: [], revocations: [] };
  const tx = {
    user: {
      findUnique: async () => state.user,
      update: async ({ data }) => {
        state.updates.push(data);
        state.user = { ...state.user, ...data };
        return state.user;
      },
    },
    authSession: {
      count: async ({ where }) => state.sessionCount,
      updateMany: async ({ where, data }) => {
        state.revocations.push({ where, data });
        const count = state.sessionCount;
        state.sessionCount = 0;
        return { count };
      },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
  };
  return {
    state,
    prismaClient: { $transaction: async callback => callback(tx) },
  };
}

test("suspending an active user revokes active sessions and audits atomically", async () => {
  const { prismaClient, state } = makePrisma({ activeSessions: 3 });
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.updateStatus({
    userId: "user-1", status: "SUSPENDED", reason: "Repeated account abuse",
    actorUserId: "admin-1",
  });

  assert.equal(result.user.status, "SUSPENDED");
  assert.equal(result.revokedCount, 3);
  assert.deepEqual(state.updates, [{ status: "SUSPENDED" }]);
  assert.equal(state.revocations.length, 1);
  assert.deepEqual(state.audits[0].before, { status: "ACTIVE" });
  assert.deepEqual(state.audits[0].after, { status: "SUSPENDED", revokedSessionCount: 3 });
  assert.equal(state.audits[0].reason, "Repeated account abuse");
  assert.equal(state.audits[0].actorUserId, "admin-1");
});

test("reactivating a verified suspended user does not create or restore sessions", async () => {
  const { prismaClient, state } = makePrisma({
    user: { id: "user-1", fullName: "Test User", email: "user@example.test", role: "CUSTOMER", status: "SUSPENDED", emailVerifiedAt: now },
    activeSessions: 0,
  });
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.updateStatus({
    userId: "user-1", status: "ACTIVE", reason: "Appeal reviewed and accepted",
    actorUserId: "admin-1",
  });
  assert.equal(result.user.status, "ACTIVE");
  assert.equal(result.revokedCount, 0);
  assert.deepEqual(state.revocations, []);
  assert.equal(state.audits[0].action, "ADMIN_USER_REACTIVATED");
});

test("administrators cannot suspend or reactivate themselves", async () => {
  const { prismaClient, state } = makePrisma();
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.updateStatus({
    userId: "user-1", status: "SUSPENDED", reason: "Test self-suspension",
    actorUserId: "user-1",
  });
  assert.equal(result.blocker, "SELF_ACCOUNT_MODIFICATION");
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.revocations, []);
});

test("administrator accounts are protected from peer modification", async () => {
  const { prismaClient, state } = makePrisma({
    user: { id: "admin-2", fullName: "Admin", email: "admin@example.test", role: "ADMIN", status: "ACTIVE", emailVerifiedAt: now },
  });
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.updateStatus({
    userId: "admin-2", status: "SUSPENDED", reason: "Test admin protection",
    actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "ADMIN_ACCOUNT_PROTECTED");
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.revocations, []);
});

test("unverified accounts cannot be reactivated", async () => {
  const { prismaClient, state } = makePrisma({
    user: { id: "user-1", fullName: "Test User", email: "user@example.test", role: "CUSTOMER", status: "SUSPENDED", emailVerifiedAt: null },
  });
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.updateStatus({
    userId: "user-1", status: "ACTIVE", reason: "Attempted reactivation",
    actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "EMAIL_VERIFICATION_REQUIRED");
  assert.deepEqual(state.updates, []);
});

test("admin session revocation audits the reason and count without changing account status", async () => {
  const { prismaClient, state } = makePrisma({ activeSessions: 2 });
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.revokeAllSessions({
    userId: "user-1", reason: "Credential compromise suspected",
    actorUserId: "admin-1",
  });
  assert.equal(result.revokedCount, 2);
  assert.deepEqual(state.updates, []);
  assert.equal(state.audits[0].action, "ADMIN_USER_SESSIONS_REVOKED");
  assert.deepEqual(state.audits[0].before, { activeSessionCount: 2 });
  assert.deepEqual(state.audits[0].after, { revokedSessionCount: 2 });
  assert.equal(state.audits[0].reason, "Credential compromise suspected");
});

test("missing users are reported without mutating sessions or audit history", async () => {
  const { prismaClient, state } = makePrisma();
  const tx = {
    user: { findUnique: async () => null },
    authSession: { count: async () => 0, updateMany: async () => ({ count: 0 }) },
    operationalAuditEvent: { create: async ({ data }) => state.audits.push(data) },
  };
  prismaClient.$transaction = async callback => callback(tx);
  const service = createAdminUsersService({ prismaClient, clock: () => now });
  const result = await service.revokeAllSessions({
    userId: "missing", reason: "Investigate compromised account",
    actorUserId: "admin-1",
  });
  assert.equal(result.notFound, true);
  assert.deepEqual(state.audits, []);
});

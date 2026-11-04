import test from "node:test";
import assert from "node:assert/strict";
import { createHubOperatorsAdminService } from "../src/modules/hub-points/hub-operators.admin.service.js";

function makePrisma({ hubStatus = "ACTIVE", managerCount = 1, member = {} } = {}) {
  const audit = [];
  const updated = [];
  const tx = {
    hubPoint: {
      findUnique: async () => ({ id: "hub-1", name: "Central Hub", status: hubStatus }),
    },
    hubPointOperator: {
      findFirst: async () => ({
        id: "member-1", hubPointId: "hub-1", userId: "user-1",
        role: "MANAGER", isActive: true, canDispatch: true, ...member,
      }),
      count: async () => managerCount,
      update: async ({ data }) => {
        const value = { id: "member-1", hubPointId: "hub-1", userId: "user-1", ...member, ...data };
        updated.push(value);
        return value;
      },
    },
    user: { findUnique: async () => ({ id: "user-1", status: "ACTIVE", emailVerifiedAt: new Date() }) },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); return data; } },
  };
  return {
    audit,
    updated,
    $transaction: async callback => callback(tx),
  };
}

test("active hub cannot lose its last eligible manager", async () => {
  const prismaClient = makePrisma({ managerCount: 0 });
  const service = createHubOperatorsAdminService({ prismaClient });

  await assert.rejects(
    service.update({
      hubPointId: "hub-1", memberId: "member-1",
      role: "OPERATOR", reason: "Reassigning hub duties", actorUserId: "admin-1",
    }),
    error => error.code === "LAST_ACTIVE_HUB_MANAGER" && error.statusCode === 409,
  );
  assert.equal(prismaClient.updated.length, 0);
  assert.equal(prismaClient.audit.length, 0);
});

test("hub operator membership updates are audited with before and after values", async () => {
  const prismaClient = makePrisma({ managerCount: 2 });
  const service = createHubOperatorsAdminService({ prismaClient });

  const result = await service.update({
    hubPointId: "hub-1", memberId: "member-1",
    canDispatch: false, reason: "Dispatch duties reassigned", actorUserId: "admin-1",
  });

  assert.equal(result.member.canDispatch, false);
  assert.equal(prismaClient.audit.length, 1);
  assert.equal(prismaClient.audit[0].actorUserId, "admin-1");
  assert.equal(prismaClient.audit[0].before.canDispatch, true);
  assert.equal(prismaClient.audit[0].after.canDispatch, false);
});

test("closed hubs reject membership changes", async () => {
  const prismaClient = makePrisma({ hubStatus: "CLOSED" });
  const service = createHubOperatorsAdminService({ prismaClient });

  const result = await service.update({
    hubPointId: "hub-1", memberId: "member-1",
    isActive: false, reason: "Removing access", actorUserId: "admin-1",
  });

  assert.equal(result.blocker, "HUB_CLOSED");
  assert.equal(prismaClient.updated.length, 0);
});

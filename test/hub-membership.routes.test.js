import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCustodyRouter } from "../src/modules/custody/custody.routes.js";
import { requireRole } from "../src/modules/auth/auth.middleware.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function createApp(prismaClient) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createCustodyRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => {
      req.user = { id: req.get("x-user-id") ?? "admin-1", role: req.get("x-user-role") ?? "CUSTOMER" };
      next();
    },
    roleMiddleware: requireRole,
  }));
  app.use(errorHandler);
  return app;
}

test("hub membership directory is ADMIN-only", async () => {
  const app = createApp({ hubPoint: { findUnique: async () => ({ id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" }) } });
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators`, {
      headers: { "x-user-role": "SUPPORT" },
    });
    assert.equal(response.status, 403);
  });
});

test("hub membership mutations require an audit reason", async () => {
  const app = createApp({});
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators/operator-1/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({ role: "MANAGER" }),
    });
    assert.equal(response.status, 400);
  });
});

test("admin hub membership list returns pagination and scoped membership data", async () => {
  const prismaClient = {
    hubPoint: { findUnique: async () => ({ id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" }) },
    hubPointOperator: {
      findMany: async () => [{ id: "operator-1", role: "MANAGER", isActive: true, user: { id: "user-1", fullName: "Hub Manager" } }],
      count: async () => 1,
    },
  };
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators?page=1&limit=10&isActive=true`, {
      headers: { "x-user-role": "ADMIN" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].user.fullName, "Hub Manager");
    assert.equal(body.data.pagination.total, 1);
  });
});


function managerMembershipPrisma({ manager = true } = {}) {
  const state = { audits: [], upserts: [], members: [] };
  const hub = { id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" };
  const managerMembership = manager
    ? { id: "manager-membership", hubPointId: "hub-1", userId: "manager-1", role: "MANAGER", isActive: true }
    : { id: "operator-membership", hubPointId: "hub-1", userId: "manager-1", role: "OPERATOR", isActive: true };
  const tx = {
    user: {
      findUnique: async () => ({ id: "staff-1", status: "ACTIVE", emailVerifiedAt: new Date(), role: "CUSTOMER" }),
      update: async () => { throw new Error("Hub membership must not mutate global roles."); },
    },
    hubPoint: { findUnique: async () => hub },
    hubPointOperator: {
      findUnique: async ({ where }) => where.hubPointId_userId.userId === "manager-1" ? managerMembership : null,
      findMany: async () => state.members,
      count: async () => state.members.length,
      upsert: async ({ create }) => {
        const operator = { id: "staff-membership", ...create };
        state.upserts.push(create);
        state.members.push(operator);
        return operator;
      },
    },
    operationalAuditEvent: { create: async ({ data }) => { state.audits.push(data); return data; } },
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

test("a hub manager with only a CUSTOMER global role can list their own hub staff", async () => {
  const { prismaClient, state } = managerMembershipPrisma();
  state.members.push({ id: "staff-membership", role: "OPERATOR", isActive: true });
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/hub-operations/hubs/hub-1/operators`, {
      headers: { "x-user-id": "manager-1", "x-user-role": "CUSTOMER" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.hub.id, "hub-1");
    assert.equal(body.data.items.length, 1);
  });
});

test("a hub manager can add an operator without a global HUB_OPERATOR role", async () => {
  const { prismaClient, state } = managerMembershipPrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/hub-operations/hubs/hub-1/operators`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "manager-1",
        "x-user-role": "CUSTOMER",
      },
      body: JSON.stringify({ userId: "staff-1", reason: "Staff assignment approved" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.data.operator.role, "OPERATOR");
    assert.equal(state.audits[0].actorUserId, "manager-1");
    assert.equal(state.audits[0].reason, "Staff assignment approved");
  });
});

test("a non-manager cannot add staff to a hub", async () => {
  const { prismaClient, state } = managerMembershipPrisma({ manager: false });
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/hub-operations/hubs/hub-1/operators`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "manager-1",
        "x-user-role": "CUSTOMER",
      },
      body: JSON.stringify({ userId: "staff-1", reason: "Staff assignment approved" }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(state.upserts, []);
    assert.deepEqual(state.audits, []);
  });
});

test("hub managers cannot grant MANAGER membership through the staff endpoint", async () => {
  const { prismaClient, state } = managerMembershipPrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/hub-operations/hubs/hub-1/operators`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "manager-1",
        "x-user-role": "CUSTOMER",
      },
      body: JSON.stringify({ userId: "staff-1", role: "MANAGER", reason: "Attempted manager grant" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(state.upserts, []);
  });
});


function dispatchPermissionPrisma() {
  const state = { updated: null, audits: [] };
  const membership = { id: "operator-1", hubPointId: "hub-1", userId: "user-1", role: "OPERATOR", isActive: true, canDispatch: false };
  const tx = {
    hubPoint: { findUnique: async () => ({ id: "hub-1", name: "Ikeja Hub", status: "ACTIVE" }) },
    hubPointOperator: {
      findFirst: async () => membership,
      update: async ({ data }) => {
        state.updated = data;
        return { ...membership, ...data };
      },
    },
    user: { findUnique: async () => ({ id: "user-1", status: "ACTIVE", emailVerifiedAt: new Date() }) },
    operationalAuditEvent: { create: async ({ data }) => { state.audits.push(data); return data; } },
  };
  return { state, prismaClient: { $transaction: async callback => callback(tx) } };
}

test("ADMIN can grant delegated dispatch permission with a mandatory reason", async () => {
  const { prismaClient, state } = dispatchPermissionPrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators/operator-1/dispatch-permission`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({
        canDispatch: true,
        reason: "Trusted operator approved for delegated dispatch",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.operator.canDispatch, true);
    assert.deepEqual(state.updated, { canDispatch: true });
    assert.equal(state.audits[0].reason, "Trusted operator approved for delegated dispatch");
  });
});

test("non-admin users cannot grant delegated dispatch permission", async () => {
  const { prismaClient, state } = dispatchPermissionPrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators/operator-1/dispatch-permission`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "SUPPORT" },
      body: JSON.stringify({ canDispatch: true, reason: "Attempted unauthorized delegation" }),
    });
    assert.equal(response.status, 403);
    assert.equal(state.updated, null);
    assert.deepEqual(state.audits, []);
  });
});

test("dispatch permission changes reject missing audit reasons", async () => {
  const { prismaClient, state } = dispatchPermissionPrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-points/hub-1/operators/operator-1/dispatch-permission`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({ canDispatch: true }),
    });
    assert.equal(response.status, 400);
    assert.equal(state.updated, null);
    assert.deepEqual(state.audits, []);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAdminUsersRouter } from "../src/modules/admin-users/admin-users.routes.js";
import { requireRole } from "../src/modules/auth/auth.middleware.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function createApp(prismaClient) {
  const app = express();
  app.use(express.json());
  const authMiddleware = (req, _res, next) => {
    req.user = { id: req.get("x-user-id") ?? "admin-1", role: req.get("x-user-role") ?? "CUSTOMER" };
    next();
  };
  app.use("/api/v1/admin/users", createAdminUsersRouter({
    prismaClient, authMiddleware, roleMiddleware: requireRole,
    clock: () => new Date("2026-11-01T12:00:00.000Z"),
  }));
  app.use(errorHandler);
  return app;
}

function makePrisma() {
  const state = {
    user: { id: "user-1", fullName: "Test User", email: "user@example.test", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: new Date() },
    revoked: 0,
    audits: [],
  };
  const tx = {
    user: {
      findUnique: async () => state.user,
      update: async ({ data }) => { state.user = { ...state.user, ...data }; return state.user; },
    },
    authSession: {
      count: async () => state.revoked ? 0 : 2,
      updateMany: async () => { const count = state.revoked ? 0 : 2; state.revoked = 2; return { count }; },
    },
    operationalAuditEvent: { create: async ({ data }) => { state.audits.push(data); return data; } },
  };
  return { state, prismaClient: { $transaction: async callback => callback(tx) } };
}

test("admin user controls reject non-admin users", async () => {
  const { prismaClient, state } = makePrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/users/user-1/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "SUPPORT" },
      body: JSON.stringify({ status: "SUSPENDED", reason: "Policy violation" }),
    });
    assert.equal(response.status, 403);
    assert.equal(state.user.status, "ACTIVE");
    assert.deepEqual(state.audits, []);
  });
});

test("admin can suspend a user and revoke all active sessions", async () => {
  const { prismaClient, state } = makePrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/users/user-1/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({ status: "SUSPENDED", reason: "Repeated policy violations" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.user.status, "SUSPENDED");
    assert.equal(body.data.revokedCount, 2);
    assert.equal(state.audits[0].action, "ADMIN_USER_SUSPENDED");
  });
});

test("admin can revoke a target user's sessions with a mandatory reason", async () => {
  const { prismaClient, state } = makePrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/users/user-1/sessions/revoke-all`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({ reason: "Suspected credential compromise" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.revokedCount, 2);
    assert.equal(state.user.status, "ACTIVE");
    assert.equal(state.audits[0].action, "ADMIN_USER_SESSIONS_REVOKED");
  });
});

test("admin account actions require a reason", async () => {
  const { prismaClient, state } = makePrisma();
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/users/user-1/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-role": "ADMIN" },
      body: JSON.stringify({ status: "SUSPENDED" }),
    });
    assert.equal(response.status, 400);
    assert.equal(state.user.status, "ACTIVE");
    assert.deepEqual(state.audits, []);
  });
});

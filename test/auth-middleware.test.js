import test from "node:test";
import assert from "node:assert/strict";
import { createAuthMiddleware } from "../src/modules/auth/auth.middleware.js";
import { signAccessToken } from "../src/modules/auth/auth.crypto.js";

const secret = "test-auth-middleware-secret-at-least-32-characters";
const activeUser = {
  id: "user-1",
  fullName: "Test User",
  email: "user@example.test",
  role: "CUSTOMER",
  status: "ACTIVE",
  emailVerifiedAt: new Date(),
};

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function requestFor(token) {
  return { get(name) { return name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined; } };
}

test("authenticated middleware accepts an active session and exposes its session id", async () => {
  const token = signAccessToken({ userId: activeUser.id, role: activeUser.role, sessionId: "session-1", secret }).token;
  const prismaClient = {
    user: { async findUnique() { return activeUser; } },
    authSession: { async findFirst({ where }) {
      assert.equal(where.id, "session-1");
      assert.equal(where.userId, activeUser.id);
      return { id: "session-1" };
    } },
  };
  const middleware = createAuthMiddleware({ prismaClient, secret });
  const req = requestFor(token);
  const res = response();
  let continued = false;
  await middleware.requireAuth(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(req.auth.sessionId, "session-1");
});

test("authenticated middleware rejects a revoked or expired session", async () => {
  const token = signAccessToken({ userId: activeUser.id, role: activeUser.role, sessionId: "session-revoked", secret }).token;
  const prismaClient = {
    user: { async findUnique() { return activeUser; } },
    authSession: { async findFirst() { return null; } },
  };
  const middleware = createAuthMiddleware({ prismaClient, secret });
  const res = response();
  let continued = false;
  await middleware.requireAuth(requestFor(token), res, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, "SESSION_REVOKED");
});

test("role middleware rejects users outside the permitted role set", () => {
  const middleware = createAuthMiddleware({ prismaClient: {}, secret });
  const res = response();
  let continued = false;
  middleware.requireRole("ADMIN")( { user: activeUser }, res, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "FORBIDDEN");
});

test("authenticated middleware trusts the current database role rather than the token role claim", async () => {
  const token = signAccessToken({
    userId: activeUser.id,
    role: "ADMIN",
    sessionId: "session-1",
    secret,
  }).token;
  const prismaClient = {
    user: { async findUnique() { return activeUser; } },
    authSession: { async findFirst() { return { id: "session-1" }; } },
  };
  const middleware = createAuthMiddleware({ prismaClient, secret });
  const res = response();
  const req = requestFor(token);
  let continued = false;
  await middleware.requireAuth(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.user.role, "CUSTOMER");
  assert.equal(req.auth.role, "CUSTOMER");
  let adminContinued = false;
  middleware.requireRole("ADMIN")(req, res, () => { adminContinued = true; });
  assert.equal(adminContinued, false);
  assert.equal(res.statusCode, 403);
});

test("authenticated middleware rejects inactive and unverified accounts", async () => {
  for (const user of [
    { ...activeUser, status: "SUSPENDED" },
    { ...activeUser, emailVerifiedAt: null },
  ]) {
    const token = signAccessToken({ userId: user.id, role: user.role, sessionId: "session-1", secret }).token;
    const middleware = createAuthMiddleware({
      prismaClient: {
        user: { async findUnique() { return user; } },
        authSession: { async findFirst() { return { id: "session-1" }; } },
      },
      secret,
    });
    const res = response();
    let continued = false;
    await middleware.requireAuth(requestFor(token), res, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  }
});

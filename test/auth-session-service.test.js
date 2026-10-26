import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSessionService } from "../src/modules/auth/auth-session.service.js";
import { hashOpaqueToken, verifyAccessToken } from "../src/modules/auth/auth.crypto.js";

const secret = "test-session-secret-that-is-at-least-32-characters";

function makeRepository() {
  const sessions = new Map();
  const users = new Map();
  return {
    sessions,
    users,
    async create(data) {
      const row = { id: `session-${sessions.size + 1}`, ...data, revokedAt: null, lastUsedAt: null };
      sessions.set(row.id, row);
      return row;
    },
    async findActiveByRefreshHash(hash, now) {
      return [...sessions.values()].find((row) => row.refreshTokenHash === hash && !row.revokedAt && row.expiresAt > now) ?? null;
    },
    async findUserForSession(id) { return users.get(id) ?? null; },
    async rotate({ id, oldHash, newHash, expiresAt, now }) {
      const row = sessions.get(id);
      if (!row || row.refreshTokenHash !== oldHash || row.revokedAt || row.expiresAt <= now) return { count: 0 };
      row.refreshTokenHash = newHash;
      row.expiresAt = expiresAt;
      row.lastUsedAt = now;
      return { count: 1 };
    },
    async revoke({ id, userId, now }) {
      const row = sessions.get(id);
      if (!row || row.userId !== userId || row.revokedAt) return { count: 0 };
      row.revokedAt = now;
      return { count: 1 };
    },
    async revokeAll({ userId, now }) {
      let count = 0;
      for (const row of sessions.values()) if (row.userId === userId && !row.revokedAt) { row.revokedAt = now; count += 1; }
      return { count };
    },
  };
}

test("refresh rotates the opaque token and binds access token to the session", async () => {
  const repository = makeRepository();
  const user = { id: "user-1", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: new Date() };
  repository.users.set(user.id, user);
  const service = createAuthSessionService({ repository, prismaClient: {}, secret });
  const issued = await service.issue(user, { userAgent: "test-agent" });
  const row = repository.sessions.get("session-1");
  assert.equal(row.refreshTokenHash, hashOpaqueToken(issued.refreshToken));
  assert.equal(row.userAgent, "test-agent");
  const claims = verifyAccessToken(issued.accessToken, secret);
  assert.equal(claims.sid, row.id);

  const rotated = await service.refresh(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  assert.equal(row.refreshTokenHash, hashOpaqueToken(rotated.refreshToken));
  await assert.rejects(() => service.refresh(issued.refreshToken), { code: "UNAUTHORIZED" });
});

test("revoked sessions cannot refresh", async () => {
  const repository = makeRepository();
  const user = { id: "user-2", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: new Date() };
  repository.users.set(user.id, user);
  const service = createAuthSessionService({ repository, prismaClient: {}, secret });
  const issued = await service.issue(user);
  await service.revoke({ sessionId: "session-1", userId: user.id });
  await assert.rejects(() => service.refresh(issued.refreshToken), { code: "UNAUTHORIZED" });
});

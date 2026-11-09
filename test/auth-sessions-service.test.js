import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSessionsService } from "../src/modules/auth/auth-sessions.service.js";
import { hashOpaqueToken, verifyAccessToken } from "../src/modules/auth/auth.crypto.js";

const secret = "test-session-secret-that-is-at-least-32-characters";
const user = { id: "user-1", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: new Date() };

function makePrisma() {
  const rows = new Map();
  let sequence = 0;
  const prismaClient = {
    authSession: {
      async create({ data }) {
        const row = { id: `session-${++sequence}`, ...data, revokedAt: null };
        rows.set(row.id, row);
        return row;
      },
      async findUnique({ where, include }) {
        const row = [...rows.values()].find((entry) => entry.tokenHash === where.tokenHash || entry.id === where.id);
        if (!row) return null;
        return include?.user ? { ...row, user } : row;
      },
      async updateMany({ where, data }) {
        const row = rows.get(where.id) ?? [...rows.values()].find((entry) => entry.tokenHash === where.tokenHash);
        if (!row || (where.userId && row.userId !== where.userId) || (where.tokenHash && row.tokenHash !== where.tokenHash) || row.revokedAt) return { count: 0 };
        if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    async $transaction(callback) { return callback(prismaClient); },
  };
  return { prismaClient, rows };
}

test("issues a hashed refresh token and a session-bound access token", async () => {
  const { prismaClient, rows } = makePrisma();
  const service = createAuthSessionsService({ prismaClient, secret });
  const issued = await service.issue(user);
  const row = rows.get("session-1");
  assert.equal(row.tokenHash, hashOpaqueToken(issued.refreshToken));
  assert.equal(row.userId, user.id);
  const claims = verifyAccessToken(issued.accessToken, secret);
  assert.equal(claims.sid, row.id);
  assert.equal(issued.expiresIn, 900);
});

test("rotates refresh tokens and rejects replay of the previous token", async () => {
  const { prismaClient, rows } = makePrisma();
  const service = createAuthSessionsService({ prismaClient, secret });
  const issued = await service.issue(user);
  const rotated = await service.refresh(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  assert.deepEqual(rotated.user, {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  });
  assert.equal(rows.get("session-1").tokenHash, hashOpaqueToken(rotated.refreshToken));
  const rotatedClaims = verifyAccessToken(rotated.accessToken, secret);
  assert.equal(rotatedClaims.sid, "session-1");
  await assert.rejects(() => service.refresh(issued.refreshToken), { code: "INVALID_REFRESH_TOKEN" });
});

test("revokes a session and prevents subsequent refresh", async () => {
  const { prismaClient } = makePrisma();
  const service = createAuthSessionsService({ prismaClient, secret });
  const issued = await service.issue(user);
  const result = await service.revokeSession({ sessionId: "session-1", userId: user.id });
  assert.equal(result.revoked, true);
  await assert.rejects(() => service.refresh(issued.refreshToken), { code: "INVALID_REFRESH_TOKEN" });
});

test("rejects session issuance for unverified or inactive accounts", async () => {
  const { prismaClient } = makePrisma();
  const service = createAuthSessionsService({ prismaClient, secret });
  await assert.rejects(() => service.issue({ ...user, emailVerifiedAt: null }), { code: "ACCOUNT_NOT_ACTIVE" });
});

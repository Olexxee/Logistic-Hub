import test from "node:test";
import assert from "node:assert/strict";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../src/modules/auth/auth.crypto.js";

const secret = "test-only-secret-that-is-at-least-32-characters-long";

test("opaque tokens are high entropy and are stored as one-way hashes", () => {
  const token = createOpaqueToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(hashOpaqueToken(token), token);
  assert.equal(hashOpaqueToken(token), hashOpaqueToken(token));
});

test("password hashing verifies correct passwords and rejects incorrect passwords", async () => {
  const encoded = await hashPassword("a-strong-password-123");
  assert.notEqual(encoded, "a-strong-password-123");
  assert.equal(await verifyPassword("a-strong-password-123", encoded), true);
  assert.equal(await verifyPassword("incorrect-password", encoded), false);
  assert.equal(await verifyPassword("anything", null), false);
});

test("access tokens are signed, expire, and reject tampering", () => {
  const now = 1_800_000_000_000;
  const { token, expiresIn } = signAccessToken({ userId: "user_123", role: "CUSTOMER", secret, now });
  assert.equal(expiresIn, 900);
  assert.deepEqual(verifyAccessToken(token, secret, now), {
    sub: "user_123",
    role: "CUSTOMER",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 900,
  });
  assert.equal(verifyAccessToken(token, secret, now + 901_000), null);
  assert.equal(verifyAccessToken(`${token.slice(0, -1)}x`, secret, now), null);
  assert.equal(verifyAccessToken(token, "short", now), null);
});

test("signing refuses weak secrets", () => {
  assert.throws(() => signAccessToken({ userId: "u1", role: "CUSTOMER", secret: "short" }), {
    code: "AUTH_NOT_CONFIGURED",
  });
});

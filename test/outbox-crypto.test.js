import test from "node:test";
import assert from "node:assert/strict";
import { encryptJobPayload, decryptJobPayload } from "../src/shared/jobs/outbox-crypto.js";

const key = Buffer.alloc(32, 7).toString("base64");

test("outbox payload encryption round-trips and does not expose plaintext", () => {
  const payload = { to: "person@example.com", subject: "Verify", text: "secret-token" };
  const encrypted = encryptJobPayload(payload, key);
  assert.equal(encrypted.includes("secret-token"), false);
  assert.deepEqual(decryptJobPayload(encrypted, key), payload);
});

test("outbox payload encryption rejects wrong keys and tampering", () => {
  const encrypted = encryptJobPayload({ text: "private" }, key);
  assert.throws(() => decryptJobPayload(encrypted, Buffer.alloc(32, 8).toString("base64")));
  assert.throws(() => decryptJobPayload(encrypted.slice(0, -2) + "aa", key));
  assert.throws(() => encryptJobPayload({ text: "private" }, "invalid"));
});

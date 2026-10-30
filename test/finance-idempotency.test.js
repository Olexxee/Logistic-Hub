import test from "node:test";
import assert from "node:assert/strict";
import { requireFinanceIdempotencyKey } from "../src/modules/finance/finance.routes.js";

function invoke(value) {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const req = { get: () => value };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  requireFinanceIdempotencyKey(req, res, () => {
    nextCalled = true;
  });
  return { statusCode, body, nextCalled };
}

test("refund idempotency validator rejects a missing key", () => {
  const result = invoke(undefined);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(result.nextCalled, false);
});

test("refund idempotency validator rejects keys shorter than eight characters", () => {
  const result = invoke("1234567");
  assert.equal(result.statusCode, 400);
  assert.equal(result.nextCalled, false);
});

test("refund idempotency validator rejects keys longer than 128 characters", () => {
  const result = invoke("x".repeat(129));
  assert.equal(result.statusCode, 400);
  assert.equal(result.nextCalled, false);
});

test("refund idempotency validator accepts keys from eight through 128 characters", () => {
  for (const key of ["12345678", "x".repeat(128)]) {
    const result = invoke(key);
    assert.equal(result.statusCode, null);
    assert.equal(result.body, null);
    assert.equal(result.nextCalled, true);
  }
});

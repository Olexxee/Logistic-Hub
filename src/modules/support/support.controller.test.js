import test from "node:test";
import assert from "node:assert/strict";
import { createSupportController } from "./support.controller.js";

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("customer support ticket listing returns pagination metadata inside the data envelope", async () => {
  const controller = createSupportController({
    listMine: async input => {
      assert.equal(input.userId, "customer-1");
      assert.equal(input.limit, 20);
      return { data: [{ id: "ticket-1" }], nextCursor: "ticket-1" };
    },
  });
  const res = responseRecorder();
  await controller.mine({ user: { id: "customer-1" }, validatedQuery: { limit: 20 } }, res, error => { throw error; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    data: { items: [{ id: "ticket-1" }], nextCursor: "ticket-1" },
  });
});

test("operator support queue returns pagination metadata inside the data envelope", async () => {
  const controller = createSupportController({
    listAdmin: async input => {
      assert.equal(input.status, "OPEN");
      assert.equal(input.limit, 50);
      return { data: [{ id: "ticket-2" }], nextCursor: null };
    },
  });
  const res = responseRecorder();
  await controller.adminList({ query: { status: "OPEN" } }, res, error => { throw error; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    data: { items: [{ id: "ticket-2" }], nextCursor: null },
  });
});

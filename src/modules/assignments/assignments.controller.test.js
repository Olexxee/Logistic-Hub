import test from "node:test";
import assert from "node:assert/strict";
import { createAssignmentsController } from "./assignments.controller.js";

test("driver assignment listing consumes validated pagination parameters", async () => {
  const controller = createAssignmentsController({
    listMine: async input => input,
  });
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await controller.listMine({
    user: { id: "driver-1" },
    validated: { query: { page: 2, limit: 10 } },
  }, res, error => { throw error; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    data: { userId: "driver-1", page: 2, limit: 10 },
  });
});

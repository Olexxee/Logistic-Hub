import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validate } from "./validate.js";

test("query validation stores parsed values in req.validated without mutating Express req.query", () => {
  const req = { query: { limit: "25" } };
  let nextCalled = false;
  validate(z.object({ limit: z.coerce.number().int().min(1).max(100) }).strict(), "query")(
    req,
    {},
    error => {
      if (error) throw error;
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, true);
  assert.deepEqual(req.validated.query, { limit: 25 });
  assert.deepEqual(req.query, { limit: "25" });
});

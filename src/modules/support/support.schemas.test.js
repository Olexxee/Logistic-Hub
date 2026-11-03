import test from "node:test";
import assert from "node:assert/strict";
import { listMyTicketsQuerySchema } from "./support.schemas.js";

test("customer support pagination defaults to the documented page size", () => {
  assert.deepEqual(listMyTicketsQuerySchema.parse({}), { limit: 20 });
});

test("customer support pagination accepts a bounded cursor and limit", () => {
  assert.deepEqual(listMyTicketsQuerySchema.parse({ cursor: "ticket-123", limit: "40" }), {
    cursor: "ticket-123",
    limit: 40,
  });
});

test("customer support pagination rejects invalid limits and empty cursors", () => {
  assert.equal(listMyTicketsQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(listMyTicketsQuerySchema.safeParse({ cursor: " " }).success, false);
});

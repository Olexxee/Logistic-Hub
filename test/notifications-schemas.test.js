import test from "node:test";
import assert from "node:assert/strict";
import { listNotificationsQuerySchema } from "../src/modules/notifications/notifications.schemas.js";

test("notification pagination is bounded and defaults to twenty items", () => {
  assert.deepEqual(listNotificationsQuerySchema.parse({}), { limit: 20 });
  assert.deepEqual(listNotificationsQuerySchema.parse({ limit: "10" }), { limit: 10 });
  assert.equal(listNotificationsQuerySchema.safeParse({ limit: "100" }).success, false);
});

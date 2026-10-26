import test from "node:test";
import assert from "node:assert/strict";
import { listHubPointsQuerySchema } from "../src/modules/hub-points/hub-points.schemas.js";

test("hub point filters default to Nigeria and bound pagination", () => {
  assert.deepEqual(listHubPointsQuerySchema.parse({}), { countryCode: "NG", limit: 20 });
  assert.equal(listHubPointsQuerySchema.safeParse({ stateCode: "LA" }).success, false);
  assert.equal(listHubPointsQuerySchema.safeParse({ limit: "100" }).success, false);
  assert.equal(listHubPointsQuerySchema.safeParse({ lgaName: "Ikeja", limit: "10" }).success, true);
});

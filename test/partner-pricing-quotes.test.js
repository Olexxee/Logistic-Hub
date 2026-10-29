import test from "node:test";
import assert from "node:assert/strict";
import { isPositiveMinorAmount } from "../src/modules/partner-pricing/partner-pricing.routes.js";

test("transport charge must be a positive integer minor-unit amount", () => {
  assert.equal(isPositiveMinorAmount("1"), true);
  assert.equal(isPositiveMinorAmount(1200n), true);
  assert.equal(isPositiveMinorAmount("0"), false);
  assert.equal(isPositiveMinorAmount("-1"), false);
  assert.equal(isPositiveMinorAmount("12.5"), false);
  assert.equal(isPositiveMinorAmount("1000000000000000"), false);
});

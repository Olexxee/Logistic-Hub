import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedAssignmentTransition, MAX_VERIFICATION_CODE_ATTEMPTS } from "./assignments.repository.js";

test("assignment lifecycle accepts only the next legal driver transition", () => {
 assert.equal(isAllowedAssignmentTransition("ACCEPTED", "ARRIVED_AT_PICKUP"), true);
 assert.equal(isAllowedAssignmentTransition("PICKUP_CONFIRMED", "IN_PROGRESS"), true);
 assert.equal(isAllowedAssignmentTransition("IN_PROGRESS", "ARRIVED_AT_DESTINATION"), true);
});

test("assignment lifecycle rejects skipped, repeated and terminal transitions", () => {
 assert.equal(isAllowedAssignmentTransition("ACCEPTED", "IN_PROGRESS"), false);
 assert.equal(isAllowedAssignmentTransition("ARRIVED_AT_PICKUP", "ARRIVED_AT_PICKUP"), false);
 assert.equal(isAllowedAssignmentTransition("COMPLETED", "ARRIVED_AT_PICKUP"), false);
 assert.equal(isAllowedAssignmentTransition("CANCELLED", "IN_PROGRESS"), false);
});

test("verification codes have a bounded failed-attempt budget", () => {
 assert.equal(MAX_VERIFICATION_CODE_ATTEMPTS, 5);
});

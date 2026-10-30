import test from "node:test";
import assert from "node:assert/strict";
import { partnerAssignmentTransition } from "../src/modules/partner-execution/partner-execution.service.js";

test("partner assignment transitions enforce offer acceptance and leg sequencing", () => {
  assert.equal(partnerAssignmentTransition("OFFERED", "ACCEPT", "PLANNED"), "ACCEPTED");
  assert.equal(partnerAssignmentTransition("OFFERED", "REJECT", "PLANNED"), "REJECTED");
  assert.equal(partnerAssignmentTransition("ACCEPTED", "START", "PLANNED"), null);
  assert.equal(partnerAssignmentTransition("ACCEPTED", "START", "READY_FOR_ASSIGNMENT"), "IN_TRANSIT");
  assert.equal(partnerAssignmentTransition("IN_TRANSIT", "ARRIVE", "IN_TRANSIT"), "ARRIVED_AT_HUB");
  assert.equal(partnerAssignmentTransition("REJECTED", "START", "READY_FOR_ASSIGNMENT"), null);
});

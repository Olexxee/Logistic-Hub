import test from "node:test";
import assert from "node:assert/strict";
import { createAssignmentsService } from "../src/modules/assignments/assignments.service.js";

const fixedNow = new Date("2026-11-09T12:00:00.000Z");
const assignment = {
  id: "assignment_hold_1",
  parcelBookingId: "booking_hold_1",
  rideBookingId: null,
  deliveryLegId: "leg_hold_1",
  driverProfileId: "driver_profile_1",
  vehicleId: "vehicle_1",
  status: "IN_PROGRESS",
  executionHoldAt: null,
  executionHoldReason: null,
  executionHoldActorUserId: null,
  executionHoldOperationalCaseId: null,
  parcelBooking: { id: "booking_hold_1", publicReference: "LH-BOOKING-1" },
  deliveryLeg: { id: "leg_hold_1", sequence: 1 },
  driverProfile: { id: "driver_profile_1", userId: "driver_user_1" },
};

function makeClient() {
  const state = { assignment: { ...assignment }, cases: [], audits: [], revoked: 0 };
  const tx = {
    driverAssignment: {
      findUnique: async () => state.assignment,
      update: async ({ data }) => { Object.assign(state.assignment, data); return state.assignment; },
    },
    operationalCase: {
      create: async ({ data }) => {
        const item = { id: "safety_case_1", ...data };
        state.cases.push(item);
        return item;
      },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
    verificationToken: {
      updateMany: async () => { state.revoked += 1; return { count: 2 }; },
    },
  };
  return {
    state,
    client: { $transaction: async callback => callback(tx) },
  };
}

test("Admin safety hold creates a critical case, revokes active codes, and audits atomically", async () => {
  const { client, state } = makeClient();
  const service = createAssignmentsService({ prismaClient: client, clock: () => fixedNow });

  const result = await service.placeExecutionHold({
    assignmentId: assignment.id,
    actorUserId: "admin_user_1",
    reason: "Reported unsafe handling; suspend driver execution pending review.",
  });

  assert.equal(result.replay, false);
  assert.equal(result.heldAt.toISOString(), fixedNow.toISOString());
  assert.equal(result.caseId, "safety_case_1");
  assert.equal(state.assignment.executionHoldAt.toISOString(), fixedNow.toISOString());
  assert.equal(state.assignment.executionHoldActorUserId, "admin_user_1");
  assert.equal(state.assignment.executionHoldOperationalCaseId, "safety_case_1");
  assert.equal(state.cases.length, 1);
  assert.equal(state.cases[0].type, "SAFETY_INCIDENT");
  assert.equal(state.cases[0].priority, "CRITICAL");
  assert.equal(state.cases[0].parcelBookingId, assignment.parcelBookingId);
  assert.equal(state.cases[0].deliveryLegId, assignment.deliveryLegId);
  assert.equal(state.revoked, 1);
  assert.equal(state.audits[0].action, "ASSIGNMENT_EXECUTION_HELD");
  assert.equal(state.audits[0].actorUserId, "admin_user_1");
});

test("repeated Admin safety hold is idempotent and does not create duplicate cases or audits", async () => {
  const { client, state } = makeClient();
  state.assignment.executionHoldAt = fixedNow;
  state.assignment.executionHoldReason = "Existing incident";
  state.assignment.executionHoldOperationalCaseId = "case_existing";
  const service = createAssignmentsService({ prismaClient: client, clock: () => fixedNow });

  const result = await service.placeExecutionHold({
    assignmentId: assignment.id,
    actorUserId: "admin_user_1",
    reason: "Duplicate admin request",
  });

  assert.equal(result.replay, true);
  assert.equal(result.caseId, "case_existing");
  assert.equal(state.cases.length, 0);
  assert.equal(state.audits.length, 0);
  assert.equal(state.revoked, 0);
});

test("Admin release clears active hold metadata and writes a reasoned audit", async () => {
  const { client, state } = makeClient();
  state.assignment.executionHoldAt = fixedNow;
  state.assignment.executionHoldReason = "Safety incident";
  state.assignment.executionHoldActorUserId = "admin_user_1";
  state.assignment.executionHoldOperationalCaseId = "case_existing";
  const service = createAssignmentsService({ prismaClient: client, clock: () => fixedNow });

  const result = await service.releaseExecutionHold({
    assignmentId: assignment.id,
    actorUserId: "admin_user_2",
    reason: "Investigation completed; operations approved resumption.",
  });

  assert.equal(result.caseId, "case_existing");
  assert.equal(state.assignment.executionHoldAt, null);
  assert.equal(state.assignment.executionHoldReason, null);
  assert.equal(state.assignment.executionHoldActorUserId, null);
  assert.equal(state.assignment.executionHoldOperationalCaseId, null);
  assert.equal(state.audits[0].action, "ASSIGNMENT_EXECUTION_HOLD_RELEASED");
  assert.equal(state.audits[0].actorUserId, "admin_user_2");
  assert.equal(state.audits[0].reason, "Investigation completed; operations approved resumption.");
});

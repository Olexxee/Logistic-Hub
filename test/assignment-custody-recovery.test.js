import test from "node:test";
import assert from "node:assert/strict";
import { createAssignmentsService } from "../src/modules/assignments/assignments.service.js";

const now = new Date("2026-11-09T12:00:00.000Z");
const sourceAssignment = {
  id: "assignment_source",
  parcelBookingId: "booking_recovery",
  rideBookingId: null,
  deliveryLegId: "leg_recovery",
  driverProfileId: "driver_source",
  vehicleId: "vehicle_source",
  assignedByUserId: "admin_original",
  status: "IN_PROGRESS",
  agreedFareMinor: 12500n,
  currency: "NGN",
  pickupAt: new Date("2026-11-09T10:00:00.000Z"),
  startedAt: new Date("2026-11-09T10:05:00.000Z"),
  executionHoldAt: new Date("2026-11-09T11:00:00.000Z"),
  executionHoldReason: "Safety report",
  executionHoldActorUserId: "admin_hold",
  executionHoldOperationalCaseId: "case_safety",
  parcelBooking: {
    id: "booking_recovery",
    publicReference: "LH-RECOVERY-1",
    pickupServiceZoneId: "zone_origin",
    destinationServiceZoneId: "zone_destination",
    status: "IN_TRANSIT",
    paymentStatus: "SUCCEEDED",
  },
  deliveryLeg: {
    id: "leg_recovery",
    type: "DIRECT",
    status: "IN_TRANSIT",
    originServiceZoneId: "zone_origin",
    destinationServiceZoneId: "zone_destination",
    originHubPointId: null,
    destinationHubPointId: null,
  },
  driverProfile: { id: "driver_source", userId: "source_user" },
  vehicle: { id: "vehicle_source" },
};
const replacementDriverProfile = {
  id: "driver_replacement",
  userId: "replacement_user",
  isOnline: true,
  isAvailable: true,
  user: { id: "replacement_user", status: "ACTIVE", role: "DRIVER", emailVerifiedAt: now },
};
const recoverySeed = {
  id: "recovery_1",
  parcelBookingId: "booking_recovery",
  deliveryLegId: "leg_recovery",
  sourceAssignmentId: "assignment_source",
  replacementDriverProfileId: "driver_replacement",
  replacementVehicleId: "vehicle_replacement",
  operationalCaseId: "case_safety",
  initiatedByUserId: "admin_user",
  status: "PENDING_RELEASE",
  reason: "Current driver cannot safely continue.",
  sourceAssignment,
  replacementDriverProfile,
  replacementVehicle: { id: "vehicle_replacement" },
  operationalCase: { id: "case_safety", status: "OPEN", priority: "CRITICAL" },
};

function makeClient({ candidateEligible = true, recovery = null } = {}) {
  const state = {
    source: { ...sourceAssignment },
    recovery: recovery ? { ...recovery } : null,
    replacementAssignment: null,
    recoveryListQuery: null,
    audits: [],
    events: [],
    driverAvailabilityWrites: [],
  };
  const tx = {
    $queryRaw: async () => [],
    driverAssignment: {
      findUnique: async () => state.source,
      findFirst: async ({ where }) => {
        if (where.driverProfileId) return null;
        if (where.vehicleId) return null;
        return null;
      },
      create: async ({ data }) => {
        state.replacementAssignment = { id: "assignment_replacement", ...data };
        return state.replacementAssignment;
      },
      update: async ({ data }) => {
        Object.assign(state.source, data);
        return state.source;
      },
    },
    driverAssignmentRecovery: {
      findFirst: async () => state.recovery && ["PENDING_RELEASE", "PENDING_RECEIPT"].includes(state.recovery.status) ? state.recovery : null,
      findUnique: async () => state.recovery,
      findMany: async args => { state.recoveryListQuery = args; return state.recovery ? [state.recovery] : []; },
      count: async () => state.recovery ? 1 : 0,
      create: async ({ data }) => {
        state.recovery = { id: "recovery_1", ...data };
        return state.recovery;
      },
      update: async ({ data }) => {
        Object.assign(state.recovery, data);
        return state.recovery;
      },
    },
    serviceZone: {
      findMany: async ({ where }) => where.id.in.map(id => ({ id })),
    },
    hubPoint: { findMany: async () => [] },
    driverProfile: {
      findFirst: async () => candidateEligible ? { id: "driver_replacement" } : null,
      findUnique: async () => ({ id: "driver_replacement", isOnline: true, isAvailable: true }),
      update: async ({ data }) => { state.driverAvailabilityWrites.push(data); return data; },
    },
    vehicle: { findFirst: async () => ({ id: "vehicle_replacement" }) },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
    bookingEvent: {
      create: async ({ data }) => { state.events.push(data); return { id: "booking_event_1", createdAt: now, ...data }; },
    },
    integrationShipmentEvent: { findUnique: async () => null },
    parcelBooking: { findUnique: async () => ({ id: "booking_recovery", integrationClientId: null, senderId: "sender_1" }) },
  };
  return { state, client: { $transaction: async callback => callback(tx), driverAssignmentRecovery: tx.driverAssignmentRecovery } };
}

test("replacement driver can list only their pending custody recovery work", async () => {
  const { client, state } = makeClient({
    recovery: {
      ...recoverySeed,
      status: "PENDING_RECEIPT",
      sourceAssignment: {
        id: "assignment_source",
        status: "IN_PROGRESS",
        pickupAt: sourceAssignment.pickupAt,
        parcelBooking: { publicReference: "LH-RECOVERY-1", pickupAddress: "Pickup", destinationAddress: "Dropoff", recipientName: "Recipient", recipientPhone: "+2348000000000" },
        deliveryLeg: { id: "leg_recovery", sequence: 1, type: "DIRECT", status: "IN_TRANSIT" },
      },
    },
  });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.listMyCustodyRecoveries({ userId: "replacement_user", page: 1, limit: 20 });

  assert.equal(state.recoveryListQuery.where.replacementDriverProfile.userId, "replacement_user");
  assert.equal(result.items[0].id, "recovery_1");
  assert.equal(result.items[0].nextAction, "CONFIRM_PHYSICAL_RECEIPT");
  assert.equal(result.items[0].sourceAssignment.parcelBooking.publicReference, "LH-RECOVERY-1");
  assert.equal(result.pagination.total, 1);
});

test("Admin initiates recovery only for a held in-custody parcel and an eligible replacement pair", async () => {
  const { client, state } = makeClient();
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.initiateCustodyRecovery({
    assignmentId: sourceAssignment.id,
    replacementDriverProfileId: "driver_replacement",
    replacementVehicleId: "vehicle_replacement",
    actorUserId: "admin_user",
    reason: "Current driver reported a credible safety threat.",
  });

  assert.equal(result.replay, false);
  assert.equal(result.recovery.status, "PENDING_RELEASE");
  assert.equal(result.recovery.operationalCaseId, "case_safety");
  assert.equal(state.replacementAssignment, null);
  assert.equal(state.audits[0].action, "DRIVER_ASSIGNMENT_RECOVERY_INITIATED");
});

test("repeated initiation for the same replacement pair is idempotent", async () => {
  const { client, state } = makeClient();
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });
  const input = {
    assignmentId: sourceAssignment.id,
    replacementDriverProfileId: "driver_replacement",
    replacementVehicleId: "vehicle_replacement",
    actorUserId: "admin_user",
    reason: "Current driver reported a credible safety threat.",
  };

  const first = await service.initiateCustodyRecovery(input);
  const second = await service.initiateCustodyRecovery(input);

  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.equal(second.recovery.id, first.recovery.id);
  assert.equal(state.audits.length, 1);
});

test("a different replacement cannot overwrite an active recovery", async () => {
  const { client } = makeClient({ recovery: { ...recoverySeed } });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.initiateCustodyRecovery({
    assignmentId: sourceAssignment.id,
    replacementDriverProfileId: "another_driver",
    replacementVehicleId: "another_vehicle",
    actorUserId: "admin_user",
    reason: "Choose a different replacement after review.",
  });

  assert.equal(result.blocker, "RECOVERY_ALREADY_ACTIVE");
});

test("current driver release records evidence but does not create or activate a replacement assignment", async () => {
  const { client, state } = makeClient({ recovery: { ...recoverySeed } });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.confirmCustodyRecoveryRelease({
    recoveryId: "recovery_1",
    userId: "source_user",
    reason: "Parcel handed directly to the replacement driver.",
    evidence: [{ uri: "https://media.example/release.jpg", type: "IMAGE" }],
  });

  assert.equal(result.recovery.status, "PENDING_RECEIPT");
  assert.equal(result.recovery.releaseConfirmedByUserId, "source_user");
  assert.equal(state.replacementAssignment, null);
  assert.equal(state.source.status, "IN_PROGRESS");
  assert.equal(state.audits[0].action, "DRIVER_CUSTODY_RELEASE_CONFIRMED");
});

test("only the source driver can confirm physical release", async () => {
  const { client, state } = makeClient({ recovery: { ...recoverySeed } });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.confirmCustodyRecoveryRelease({
    recoveryId: "recovery_1",
    userId: "someone_else",
    reason: "Attempted unauthorized release.",
    evidence: [{ uri: "https://media.example/release.jpg", type: "IMAGE" }],
  });

  assert.equal(result.forbidden, true);
  assert.equal(state.recovery.status, "PENDING_RELEASE");
  assert.equal(state.audits.length, 0);
});

test("source driver cannot release custody to a replacement that has become ineligible", async () => {
  const { client, state } = makeClient({
    candidateEligible: false,
    recovery: { ...recoverySeed },
  });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.confirmCustodyRecoveryRelease({
    recoveryId: "recovery_1",
    userId: "source_user",
    reason: "Attempted release to the nominated replacement.",
    evidence: [{ uri: "https://media.example/release.jpg", type: "IMAGE" }],
  });

  assert.equal(result.ineligible.code, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
  assert.equal(state.recovery.status, "PENDING_RELEASE");
  assert.equal(state.audits.length, 0);
});

test("Admin release exception records reason and evidence without pretending the source driver confirmed", async () => {
  const { client, state } = makeClient({ recovery: { ...recoverySeed } });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.authorizeCustodyRecoveryReleaseException({
    recoveryId: "recovery_1",
    actorUserId: "admin_user",
    reason: "Current custodian is unreachable and a police incident report is attached.",
    evidence: [{ uri: "https://media.example/incident.pdf", type: "DOCUMENT" }],
  });

  assert.equal(result.recovery.status, "PENDING_RECEIPT");
  assert.equal(result.recovery.exceptionAuthorizedByUserId, "admin_user");
  assert.equal(result.recovery.releaseConfirmedByUserId ?? null, null);
  assert.equal(state.audits[0].action, "DRIVER_CUSTODY_RELEASE_EXCEPTION_AUTHORIZED");
});

test("Admin can cancel a pending recovery without releasing the source safety hold", async () => {
  const { client, state } = makeClient({ recovery: { ...recoverySeed } });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.cancelCustodyRecovery({
    recoveryId: "recovery_1",
    actorUserId: "admin_user",
    reason: "Replacement driver became unavailable; select another candidate.",
  });

  assert.equal(result.recovery.status, "CANCELLED");
  assert.equal(result.recovery.cancelledByUserId, "admin_user");
  assert.equal(state.source.executionHoldAt.toISOString(), sourceAssignment.executionHoldAt.toISOString());
  assert.equal(state.source.status, "IN_PROGRESS");
  assert.equal(state.audits[0].action, "DRIVER_CUSTODY_RECOVERY_CANCELLED");
});

test("replacement driver receipt creates a new assignment and retires the source atomically", async () => {
  const { client, state } = makeClient({ recovery: { ...recoverySeed, status: "PENDING_RECEIPT", releaseConfirmedByUserId: "source_user" } });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.confirmCustodyRecoveryReceipt({
    recoveryId: "recovery_1",
    userId: "replacement_user",
    conditionAtReceipt: "Parcel seal intact; outer carton has one corner crease.",
    evidence: [{ uri: "https://media.example/receipt.jpg", type: "IMAGE" }],
  });

  assert.equal(result.recovery.status, "CONFIRMED");
  assert.equal(result.replacementAssignment.status, "IN_PROGRESS");
  assert.equal(result.replacementAssignment.driverProfileId, "driver_replacement");
  assert.equal(result.replacementAssignment.vehicleId, "vehicle_replacement");
  assert.equal(result.replacementAssignment.payoutReviewRequired, true);
  assert.equal(state.source.status, "FAILED");
  assert.equal(state.source.executionHoldAt, null);
  assert.match(state.source.failureReason, /CUSTODY_RECOVERED_TO_ASSIGNMENT/);
  assert.deepEqual(state.driverAvailabilityWrites, [{ isAvailable: false }]);
  assert.equal(state.events[0].eventType, "DRIVER_ASSIGNMENT_CUSTODY_RECOVERED");
  assert.equal(state.audits[0].action, "DRIVER_CUSTODY_RECOVERY_CONFIRMED");
});

test("replacement eligibility is revalidated at receipt and stale candidates cannot receive custody", async () => {
  const { client, state } = makeClient({
    candidateEligible: false,
    recovery: { ...recoverySeed, status: "PENDING_RECEIPT", releaseConfirmedByUserId: "source_user" },
  });
  const service = createAssignmentsService({ prismaClient: client, clock: () => now });

  const result = await service.confirmCustodyRecoveryReceipt({
    recoveryId: "recovery_1",
    userId: "replacement_user",
    conditionAtReceipt: "Parcel received.",
    evidence: [{ uri: "https://media.example/receipt.jpg", type: "IMAGE" }],
  });

  assert.equal(result.ineligible.code, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
  assert.equal(state.replacementAssignment, null);
  assert.equal(state.source.status, "IN_PROGRESS");
  assert.equal(state.recovery.status, "PENDING_RECEIPT");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerExecutionService } from "../src/modules/partner-execution/partner-execution.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
function transaction(tx) {
  return { ...tx, $transaction: async callback => callback(tx) };
}

test("partner assignment uses the accepted contracted quote and is audited transactionally", async () => {
  const audit = [];
  const created = [];
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => { created.push(data); return { id: "assignment-1", ...data }; },
    },
    deliveryLeg: {
      findUnique: async () => ({
        id: "leg-1", type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
        parcelBookingId: "booking-1", parcelBooking: { id: "booking-1", paymentStatus: "SUCCEEDED", status: "AWAITING_PAYMENT" },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    shipmentQuote: {
      findFirst: async () => ({ id: "quote-1", partnerAgreementId: "agreement-1", transportChargeMinor: 450000n, currency: "NGN" }),
    },
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" }),
    },
    partnerAgreement: {
      findUnique: async () => ({
        id: "agreement-1", partnerId: "partner-1", status: "ACTIVE", currency: "NGN",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveUntil: null,
        partner: { id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" },
      }),
    },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.assignLeg({
    deliveryLegId: "leg-1", partnerId: "partner-1", idempotencyKey: "assign-leg-0001", actorUserId: "admin-1",
  });
  assert.equal(result.replay, false);
  assert.equal(created[0].agreedTransportChargeMinor, 450000n);
  assert.equal(created[0].agreementId, "agreement-1");
  assert.equal(audit[0].action, "PARTNER_LEG_ASSIGNED");
});

test("partner assignment is blocked until payment is verified", async () => {
  const tx = {
    partnerDeliveryAssignment: { findUnique: async () => null },
    deliveryLeg: { findUnique: async () => ({
      id: "leg-1", type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
      parcelBookingId: "booking-1", parcelBooking: { id: "booking-1", paymentStatus: "PENDING" },
    }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.assignLeg({
    deliveryLegId: "leg-1", partnerId: "partner-1", idempotencyKey: "assign-leg-0002", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "BOOKING_NOT_PAID");
});

test("idempotency key cannot be reused for another leg or partner", async () => {
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => ({ id: "assignment-1", deliveryLegId: "leg-other", partnerId: "partner-1" }),
    },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(
    service.assignLeg({ deliveryLegId: "leg-1", partnerId: "partner-1", idempotencyKey: "assign-leg-0003", actorUserId: "admin-1" }),
    error => error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("partner member can accept and start only its own assignment", async () => {
  const audit = [];
  let assignmentStatus = "ASSIGNED";
  let legStatus = "ASSIGNED";
  const assignment = { id: "assignment-1", partnerId: "partner-1", deliveryLegId: "leg-1", status: "ASSIGNED" };
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => ({ ...assignment, status: assignmentStatus, partner: {}, deliveryLeg: {} }),
      updateMany: async ({ where, data }) => {
        if (assignmentStatus !== where.status) return { count: 0 };
        assignmentStatus = data.status;
        return { count: 1 };
      },
    },
    transportPartnerMember: {
      findUnique: async () => ({ partnerId: "partner-1", userId: "operator-1", isActive: true }),
    },
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" }),
    },
    deliveryLeg: {
      updateMany: async ({ where, data }) => {
        if (legStatus !== where.status) return { count: 0 };
        legStatus = data.status;
        return { count: 1 };
      },
    },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const accepted = await service.acceptAssignment({ assignmentId: "assignment-1", userId: "operator-1" });
  assert.equal(accepted.assignment.status, "ACCEPTED");
  const started = await service.startAssignment({ assignmentId: "assignment-1", userId: "operator-1" });
  assert.equal(started.assignment.status, "IN_TRANSIT");
  assert.equal(legStatus, "IN_TRANSIT");
  assert.equal(audit.length, 2);
});

test("a user without an active partner membership cannot accept an assignment", async () => {
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => ({ id: "assignment-1", partnerId: "partner-1", deliveryLegId: "leg-1", status: "ASSIGNED" }),
    },
    transportPartnerMember: { findUnique: async () => null },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(
    service.acceptAssignment({ assignmentId: "assignment-1", userId: "intruder-1" }),
    error => error.statusCode === 403 && error.code === "PARTNER_MEMBERSHIP_REQUIRED",
  );
});


test("partner assignment queue is scoped to active memberships and paginated", async () => {
  let capturedFindMany;
  let capturedCount;
  const rows = [{ id: "assignment-1", status: "ASSIGNED" }];
  const tx = {
    transportPartnerMember: {
      findMany: async args => {
        assert.equal(args.where.userId, "operator-1");
        assert.equal(args.where.isActive, true);
        return [{ partnerId: "partner-1" }, { partnerId: "partner-2" }];
      },
    },
    partnerDeliveryAssignment: {
      findMany: async args => { capturedFindMany = args; return rows; },
      count: async args => { capturedCount = args; return 31; },
    },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.listMyAssignments({ userId: "operator-1", page: 2, limit: 10 });

  assert.deepEqual(capturedFindMany.where, { partnerId: { in: ["partner-1", "partner-2"] } });
  assert.equal(capturedFindMany.skip, 10);
  assert.equal(capturedFindMany.take, 10);
  assert.deepEqual(capturedCount, { where: { partnerId: { in: ["partner-1", "partner-2"] } } });
  assert.deepEqual(result, {
    items: rows,
    pagination: { page: 2, limit: 10, total: 31, totalPages: 4 },
  });
});

test("partner assignment queue rejects users without active partner memberships", async () => {
  const tx = {
    transportPartnerMember: { findMany: async () => [] },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(
    service.listMyAssignments({ userId: "operator-2", page: 1, limit: 20 }),
    error => error.statusCode === 403 && error.code === "PARTNER_MEMBERSHIP_REQUIRED",
  );
});


test("a suspended partner cannot accept an assignment despite an active membership", async () => {
  const tx = {
    partnerDeliveryAssignment: { findUnique: async () => ({ id: "assignment-1", partnerId: "partner-1", status: "ASSIGNED" }) },
    transportPartnerMember: { findUnique: async () => ({ isActive: true }) },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "SUSPENDED", verificationStatus: "VERIFIED" }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(service.acceptAssignment({ assignmentId: "assignment-1", userId: "operator-1" }),
    error => error.statusCode === 409 && error.code === "PARTNER_NOT_OPERATIONAL");
});

test("the last active owner cannot be demoted", async () => {
  const tx = {
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "ACTIVE" }) },
    user: { findUnique: async () => ({ id: "user-1", status: "ACTIVE", emailVerifiedAt: now, role: "PARTNER_OPERATOR" }) },
    transportPartnerMember: {
      findUnique: async () => ({ id: "member-1", role: "OWNER", isActive: true }),
      count: async () => 0,
    },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.addMember({ partnerId: "partner-1", userId: "user-1", role: "OPERATIONS", reason: "Assigning operational access.", actorUserId: "admin-1" });
  assert.equal(result.blocker, "LAST_ACTIVE_OWNER");
});


test("a suspended partner can deactivate its final owner before closure", async () => {
  let updatedMembership;
  const tx = {
    transportPartnerMember: {
      findFirst: async () => ({ id: "member-1", partnerId: "partner-1", userId: "owner-1", role: "OWNER", isActive: true }),
      update: async ({ data }) => { updatedMembership = data; return { id: "member-1", ...data }; },
      count: async () => 0,
    },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "SUSPENDED" }) },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.setMemberStatus({
    partnerId: "partner-1", memberId: "member-1", isActive: false, reason: "Removing this operator access.", actorUserId: "admin-1",
  });
  assert.equal(result.member.isActive, false);
  assert.deepEqual(updatedMembership, { isActive: false, role: "OWNER" });
});


test("adding a partner membership preserves the user's global account role", async () => {
  const audit = [];
  const tx = {
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "PENDING" }) },
    user: {
      findUnique: async () => ({ id: "customer-1", status: "ACTIVE", emailVerifiedAt: now, role: "CUSTOMER" }),
      update: async () => { throw new Error("Membership must not mutate the global user role."); },
    },
    transportPartnerMember: {
      findUnique: async () => null,
      upsert: async ({ create }) => ({ id: "member-1", ...create }),
    },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); return data; } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.addMember({
    partnerId: "partner-1", userId: "customer-1", role: "OPERATIONS", reason: "Assigning partner operations access.", actorUserId: "admin-1",
  });
  assert.equal(result.member.userId, "customer-1");
  assert.equal(result.member.role, "OPERATIONS");
  assert.equal(audit[0].before, null);
  assert.deepEqual(audit[0].after, {
    partnerId: "partner-1", userId: "customer-1", role: "OPERATIONS", isActive: true,
  });
});

test("deactivating a partner membership does not demote the global user role", async () => {
  let userRoleMutationAttempts = 0;
  const tx = {
    transportPartnerMember: {
      findFirst: async () => ({ id: "member-1", partnerId: "partner-1", userId: "operator-1", role: "OPERATIONS", isActive: true }),
      update: async ({ data }) => ({ id: "member-1", userId: "operator-1", role: "OPERATIONS", ...data }),
    },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "SUSPENDED" }) },
    user: { updateMany: async () => { userRoleMutationAttempts += 1; } },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.setMemberStatus({
    partnerId: "partner-1", memberId: "member-1", isActive: false, reason: "Removing this operator access.", actorUserId: "admin-1",
  });
  assert.equal(result.member.isActive, false);
  assert.equal(userRoleMutationAttempts, 0);
});


test("partner member directory is scoped, searchable, filterable and paginated", async () => {
  let findArgs;
  let countArgs;
  const rows = [{ id: "member-1", role: "OPERATIONS", isActive: true }];
  const tx = {
    transportPartner: { findUnique: async () => ({ id: "partner-1" }) },
    transportPartnerMember: {
      findMany: async args => { findArgs = args; return rows; },
      count: async args => { countArgs = args; return 21; },
    },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.listMembers({
    partnerId: "partner-1", page: 2, limit: 10, search: "operator", role: "OPERATIONS", isActive: true,
  });
  assert.equal(findArgs.where.partnerId, "partner-1");
  assert.equal(findArgs.where.role, "OPERATIONS");
  assert.equal(findArgs.where.isActive, true);
  assert.deepEqual(findArgs.where.user.OR.map(item => Object.keys(item)[0]), ["fullName", "email", "phone"]);
  assert.equal(findArgs.skip, 10);
  assert.equal(findArgs.take, 10);
  assert.deepEqual(countArgs.where, findArgs.where);
  assert.deepEqual(result, { items: rows, pagination: { page: 2, limit: 10, total: 21, totalPages: 3 } });
});

test("partner member directory returns not found for an unknown partner", async () => {
  const tx = { transportPartner: { findUnique: async () => null } };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  assert.deepEqual(await service.listMembers({ partnerId: "missing" }), { notFound: true });
});

test("membership audit captures reason and full role/status before and after", async () => {
  const audit = [];
  const tx = {
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "PENDING" }) },
    user: { findUnique: async () => ({ id: "user-1", status: "ACTIVE", emailVerifiedAt: now }) },
    transportPartnerMember: {
      findUnique: async () => ({ id: "member-1", partnerId: "partner-1", userId: "user-1", role: "OPERATIONS", isActive: false }),
      upsert: async ({ update }) => ({ id: "member-1", partnerId: "partner-1", userId: "user-1", ...update }),
    },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.addMember({
    partnerId: "partner-1", userId: "user-1", role: "DISPATCHER",
    reason: "Restore dispatcher access after review.", actorUserId: "admin-1",
  });
  assert.equal(result.member.isActive, true);
  assert.equal(audit[0].reason, "Restore dispatcher access after review.");
  assert.equal(audit[0].action, "PARTNER_MEMBER_REACTIVATED");
  assert.deepEqual(audit[0].before, { partnerId: "partner-1", userId: "user-1", role: "OPERATIONS", isActive: false });
  assert.deepEqual(audit[0].after, { partnerId: "partner-1", userId: "user-1", role: "DISPATCHER", isActive: true });
});

test("an inactive or unverified account cannot have partner membership reactivated", async () => {
  const tx = {
    transportPartnerMember: {
      findFirst: async () => ({ id: "member-1", partnerId: "partner-1", userId: "user-1", role: "OPERATIONS", isActive: false }),
    },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "SUSPENDED" }) },
    user: { findUnique: async () => ({ status: "PENDING", emailVerifiedAt: null }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.setMemberStatus({
    partnerId: "partner-1", memberId: "member-1", isActive: true,
    reason: "Reactivation requested.", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "USER_NOT_ACTIVE");
});


test("changing an active owner's role preserves the last active OWNER safeguard", async () => {
  const audit = [];
  let updateData;
  const tx = {
    transportPartnerMember: {
      findFirst: async () => ({ id: "member-1", partnerId: "partner-1", userId: "owner-1", role: "OWNER", isActive: true }),
      count: async ({ where }) => {
        assert.equal(where.role, "OWNER");
        assert.equal(where.id.not, "member-1");
        return 0;
      },
      update: async ({ data }) => { updateData = data; return { id: "member-1", userId: "owner-1", ...data }; },
    },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "ACTIVE" }) },
    user: { findUnique: async () => ({ status: "ACTIVE", emailVerifiedAt: now }) },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const blocked = await service.setMemberStatus({
    partnerId: "partner-1", memberId: "member-1", role: "OPERATIONS",
    reason: "Change owner role after staffing review.", actorUserId: "admin-1",
  });
  assert.equal(blocked.blocker, "LAST_ACTIVE_OWNER");
  assert.equal(updateData, undefined);
  assert.equal(audit.length, 0);
});


test("reactivating a non-owner is blocked when an active partner has no eligible owner", async () => {
  let updateAttempts = 0;
  const tx = {
    transportPartnerMember: {
      findFirst: async () => ({ id: "member-1", partnerId: "partner-1", userId: "operator-1", role: "OPERATIONS", isActive: false }),
      count: async ({ where }) => {
        assert.equal(where.partnerId, "partner-1");
        assert.equal(where.role, "OWNER");
        assert.equal(where.isActive, true);
        assert.equal(where.id.not, "member-1");
        return 0;
      },
      update: async () => { updateAttempts += 1; },
    },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "ACTIVE" }) },
    user: { findUnique: async () => ({ status: "ACTIVE", emailVerifiedAt: now }) },
    operationalAuditEvent: { create: async () => { throw new Error("Blocked membership changes must not be audited as successful."); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.setMemberStatus({
    partnerId: "partner-1", memberId: "member-1", isActive: true,
    reason: "Restore operator after account verification.",
    actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "LAST_ACTIVE_OWNER");
  assert.equal(updateAttempts, 0);
});


test("partner assignment advances a paid integration-owned shipment from awaiting assignment to driver assigned", async () => {
  const bookingUpdates = [];
  const bookingEvents = [];
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "integration-assignment-1", ...data }),
    },
    deliveryLeg: {
      findUnique: async () => ({
        id: "integration-leg-1", type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
        parcelBookingId: "integration-booking-1",
        parcelBooking: {
          id: "integration-booking-1", paymentStatus: "SUCCEEDED",
          status: "AWAITING_PARTNER_ASSIGNMENT", integrationClientId: "client-1",
        },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    shipmentQuote: {
      findFirst: async () => ({
        id: "integration-quote-1", partnerAgreementId: "agreement-1",
        transportChargeMinor: 450000n, currency: "NGN",
      }),
    },
    partnerAgreement: {
      findUnique: async () => ({
        id: "agreement-1", partnerId: "partner-1", status: "ACTIVE", currency: "NGN",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveUntil: null,
        partner: { id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" },
      }),
    },
    parcelBooking: {
      updateMany: async args => { bookingUpdates.push(args); return { count: 1 }; },
    },
    bookingEvent: {
      create: async ({ data }) => { bookingEvents.push(data); return data; },
    },
    operationalAuditEvent: { create: async () => ({ id: "audit-integration-1" }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.assignLeg({
    deliveryLegId: "integration-leg-1", partnerId: "partner-1",
    idempotencyKey: "assign-integration-leg-01", actorUserId: "admin-1",
  });

  assert.equal(result.replay, false);
  assert.equal(bookingUpdates.length, 1);
  assert.deepEqual(bookingUpdates[0].where, {
    id: "integration-booking-1",
    integrationClientId: "client-1",
    status: "AWAITING_PARTNER_ASSIGNMENT",
    paymentStatus: "SUCCEEDED",
  });
  assert.deepEqual(bookingUpdates[0].data, { status: "DRIVER_ASSIGNED" });
  assert.equal(bookingEvents[0].eventType, "INTEGRATION_PARTNER_ASSIGNMENT_CREATED");
  assert.equal(bookingEvents[0].fromStatus, "AWAITING_PARTNER_ASSIGNMENT");
  assert.equal(bookingEvents[0].toStatus, "DRIVER_ASSIGNED");
});

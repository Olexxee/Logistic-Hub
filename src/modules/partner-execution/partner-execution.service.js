import { createPartnerExecutionRepository } from "./partner-execution.repository.js";

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}
function forbidden(message = "You are not an active member of this transport partner.") {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = "PARTNER_MEMBERSHIP_REQUIRED";
  return error;
}

export function createPartnerExecutionService({ prismaClient, clock = () => new Date() }) {
  const repository = createPartnerExecutionRepository({ prismaClient });

  async function requirePartnerMembership(tx, partnerId, userId) {
    const membership = await repository.findMembership(partnerId, userId, tx);
    if (!membership?.isActive) throw forbidden();
    return membership;
  }

  return {
    async addMember({ partnerId, userId, role = "OPERATIONS", actorUserId }) {
      return prismaClient.$transaction(async tx => {
        const partner = await repository.findPartner(partnerId, tx);
        if (!partner) return { notFound: true };
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
          return { blocker: "USER_NOT_ACTIVE" };
        }
        if (!["CUSTOMER", "PARTNER_OPERATOR", "HUB_OPERATOR"].includes(user.role)) {
          return { blocker: "USER_ROLE_CONFLICT" };
        }
        const member = await tx.transportPartnerMember.upsert({
          where: { partnerId_userId: { partnerId, userId } },
          create: { partnerId, userId, role, isActive: true },
          update: { role, isActive: true },
        });
        if (user.role === "CUSTOMER") {
          await tx.user.update({ where: { id: userId }, data: { role: "PARTNER_OPERATOR" } });
        }
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "TRANSPORT_PARTNER_MEMBER", entityId: member.id,
          action: "PARTNER_MEMBER_ACTIVATED", before: { userRole: user.role }, after: { partnerId, userId, role, isActive: true, userRole: user.role === "CUSTOMER" ? "PARTNER_OPERATOR" : user.role },
        } });
        return { member };
      });
    },

    async setMemberStatus({ partnerId, memberId, isActive, actorUserId }) {
      return prismaClient.$transaction(async tx => {
        const member = await tx.transportPartnerMember.findFirst({ where: { id: memberId, partnerId } });
        if (!member) return { notFound: true };
        const updated = await tx.transportPartnerMember.update({
          where: { id: member.id }, data: { isActive },
        });
        const activeMemberships = await tx.transportPartnerMember.count({
          where: { userId: member.userId, isActive: true },
        });
        const activeHubMemberships = await tx.hubPointOperator.count({
          where: { userId: member.userId, isActive: true },
        });
        if (!activeMemberships && !activeHubMemberships) {
          await tx.user.updateMany({
            where: { id: member.userId, role: { in: ["PARTNER_OPERATOR", "HUB_OPERATOR"] } },
            data: { role: "CUSTOMER" },
          });
        }
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "TRANSPORT_PARTNER_MEMBER", entityId: member.id,
          action: isActive ? "PARTNER_MEMBER_ACTIVATED" : "PARTNER_MEMBER_SUSPENDED",
          before: { isActive: member.isActive }, after: { isActive: updated.isActive },
        } });
        return { member: updated };
      });
    },

    async assignLeg({ deliveryLegId, partnerId, idempotencyKey, actorUserId }) {
      return prismaClient.$transaction(async tx => {
        const existing = await repository.findAssignmentByIdempotencyKey(idempotencyKey, tx);
        if (existing) {
          if (existing.deliveryLegId !== deliveryLegId || existing.partnerId !== partnerId) {
            throw conflict("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different partner assignment.");
          }
          return { assignment: existing, replay: true };
        }

        const leg = await repository.findLegForAssignment(deliveryLegId, tx);
        if (!leg) return { notFound: true };
        if (leg.type !== "INTERSTATE_TRANSPORT") return { blocker: "LEG_NOT_PARTNER_EXECUTED" };
        if (leg.status !== "READY_FOR_ASSIGNMENT") return { blocker: "LEG_NOT_READY" };
        if (leg.parcelBooking.paymentStatus !== "SUCCEEDED") return { blocker: "BOOKING_NOT_PAID" };

        const acceptedQuote = await tx.shipmentQuote.findFirst({
          where: { parcelBookingId: leg.parcelBookingId, status: "ACCEPTED" },
          orderBy: { version: "desc" },
        });
        if (!acceptedQuote?.partnerAgreementId) return { blocker: "ACCEPTED_PARTNER_QUOTE_REQUIRED" };

        const agreement = await repository.findActiveAgreement(acceptedQuote.partnerAgreementId, tx);
        const now = clock();
        if (!agreement || agreement.partnerId !== partnerId ||
          agreement.status !== "ACTIVE" ||
          agreement.currency !== acceptedQuote.currency ||
          agreement.partner.status !== "ACTIVE" ||
          agreement.partner.verificationStatus !== "VERIFIED" ||
          agreement.effectiveFrom > now ||
          (agreement.effectiveUntil && agreement.effectiveUntil <= now)) {
          return { blocker: "PARTNER_AGREEMENT_INELIGIBLE" };
        }

        const activeAssignment = await tx.partnerDeliveryAssignment.findFirst({
          where: { deliveryLegId, status: { in: ["ASSIGNED", "ACCEPTED", "IN_TRANSIT"] } },
        });
        if (activeAssignment) return { blocker: "ACTIVE_PARTNER_ASSIGNMENT_EXISTS" };

        const claimed = await tx.deliveryLeg.updateMany({
          where: { id: deliveryLegId, status: "READY_FOR_ASSIGNMENT" },
          data: { status: "ASSIGNED", assignedAt: now },
        });
        if (claimed.count !== 1) return { blocker: "LEG_NOT_READY" };

        const assignment = await repository.createAssignment({
          deliveryLegId, partnerId, agreementId: agreement.id, assignedByUserId: actorUserId,
          status: "ASSIGNED", agreedTransportChargeMinor: acceptedQuote.transportChargeMinor,
          currency: acceptedQuote.currency, idempotencyKey, assignedAt: now,
        }, tx);
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "PARTNER_DELIVERY_ASSIGNMENT", entityId: assignment.id,
          action: "PARTNER_LEG_ASSIGNED",
          after: { deliveryLegId, partnerId, agreementId: agreement.id, agreedTransportChargeMinor: acceptedQuote.transportChargeMinor.toString(), currency: acceptedQuote.currency },
        } });
        return { assignment, replay: false };
      });
    },

    async listMyAssignments({ userId }) {
      const memberships = await repository.findMembershipsForUser(userId);
      const partnerIds = memberships.map(item => item.partnerId);
      if (!partnerIds.length) throw forbidden();
      return repository.listAssignments(partnerIds);
    },

    async acceptAssignment({ assignmentId, userId }) {
      return prismaClient.$transaction(async tx => {
        const assignment = await repository.findAssignment(assignmentId, tx);
        if (!assignment) return { notFound: true };
        await requirePartnerMembership(tx, assignment.partnerId, userId);
        if (assignment.status === "ACCEPTED") return { assignment, replay: true };
        if (assignment.status !== "ASSIGNED") return { blocker: "ASSIGNMENT_NOT_ACCEPTABLE" };
        const now = clock();
        const changed = await tx.partnerDeliveryAssignment.updateMany({
          where: { id: assignmentId, status: "ASSIGNED" },
          data: { status: "ACCEPTED", acceptedAt: now },
        });
        if (changed.count !== 1) return { blocker: "ASSIGNMENT_NOT_ACCEPTABLE" };
        const updated = await repository.findAssignment(assignmentId, tx);
        await tx.operationalAuditEvent.create({ data: {
          actorUserId: userId, entityType: "PARTNER_DELIVERY_ASSIGNMENT", entityId: assignmentId,
          action: "PARTNER_LEG_ACCEPTED", before: { status: assignment.status }, after: { status: updated.status },
        } });
        return { assignment: updated, replay: false };
      });
    },

    async startAssignment({ assignmentId, userId }) {
      return prismaClient.$transaction(async tx => {
        const assignment = await repository.findAssignment(assignmentId, tx);
        if (!assignment) return { notFound: true };
        await requirePartnerMembership(tx, assignment.partnerId, userId);
        if (assignment.status === "IN_TRANSIT") return { assignment, replay: true };
        if (assignment.status !== "ACCEPTED") return { blocker: "ASSIGNMENT_NOT_STARTABLE" };
        const now = clock();
        const changed = await tx.partnerDeliveryAssignment.updateMany({
          where: { id: assignmentId, status: "ACCEPTED" },
          data: { status: "IN_TRANSIT", startedAt: now },
        });
        if (changed.count !== 1) return { blocker: "ASSIGNMENT_NOT_STARTABLE" };
        const legChanged = await tx.deliveryLeg.updateMany({
          where: { id: assignment.deliveryLegId, status: "ASSIGNED" },
          data: { status: "IN_TRANSIT", startedAt: now },
        });
        if (legChanged.count !== 1) {
          throw conflict("DELIVERY_LEG_NOT_STARTABLE", "The delivery leg is no longer assigned and cannot be started.");
        }
        const updated = await repository.findAssignment(assignmentId, tx);
        await tx.operationalAuditEvent.create({ data: {
          actorUserId: userId, entityType: "PARTNER_DELIVERY_ASSIGNMENT", entityId: assignmentId,
          action: "PARTNER_LEG_STARTED", before: { status: assignment.status }, after: { status: updated.status },
        } });
        return { assignment: updated, replay: false };
      });
    },
  };
}

import { projectIntegrationShipmentEvent } from "../integrations/integration-shipment-events.projector.js";
import { createPartnerExecutionRepository } from "./partner-execution.repository.js";

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}
async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
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
    const partner = await repository.findPartner(partnerId, tx);
    if (!partner || partner.status !== "ACTIVE" || partner.verificationStatus !== "VERIFIED") {
      throw conflict("PARTNER_NOT_OPERATIONAL", "The transport partner is not active and verified.");
    }
    return membership;
  }

  return {
    async listMembers({ partnerId, page = 1, limit = 20, search, role, isActive }) {
      const partner = await repository.findPartner(partnerId);
      if (!partner) return { notFound: true };
      const where = {
        ...(role ? { role } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(search ? { user: { OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ] } } : {}),
      };
      const result = await repository.listPartnerMembers(partnerId, { where, skip: (page - 1) * limit, take: limit });
      return {
        items: result.items,
        pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
      };
    },

    async addMember({ partnerId, userId, role = "OPERATIONS", reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const partner = await repository.findPartner(partnerId, tx);
        if (!partner) return { notFound: true };
        if (partner.status === "CLOSED") return { blocker: "PARTNER_CLOSED" };
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
          return { blocker: "USER_NOT_ACTIVE" };
        }
        const existingMember = await tx.transportPartnerMember.findUnique({
          where: { partnerId_userId: { partnerId, userId } },
        });
        if (existingMember?.isActive && existingMember.role === role) {
          return { member: existingMember, unchanged: true };
        }
        if (partner.status === "ACTIVE" && role !== "OWNER") {
          const ownerWhere = {
            partnerId, isActive: true, role: "OWNER",
            user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
            ...(existingMember ? { id: { not: existingMember.id } } : {}),
          };
          const otherOwners = await tx.transportPartnerMember.count({ where: ownerWhere });
          if (!otherOwners) return { blocker: "LAST_ACTIVE_OWNER" };
        }
        const member = await tx.transportPartnerMember.upsert({
          where: { partnerId_userId: { partnerId, userId } },
          create: { partnerId, userId, role, isActive: true },
          update: { role, isActive: true },
        });
        const action = !existingMember
          ? "PARTNER_MEMBER_ADDED"
          : !existingMember.isActive
            ? "PARTNER_MEMBER_REACTIVATED"
            : "PARTNER_MEMBER_ROLE_UPDATED";
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "TRANSPORT_PARTNER_MEMBER", entityId: member.id,
          action, reason,
          before: existingMember ? {
            partnerId, userId, role: existingMember.role, isActive: existingMember.isActive,
          } : null,
          after: { partnerId, userId, role: member.role, isActive: member.isActive },
        } });
        return { member };
      });
    },

    async setMemberStatus({ partnerId, memberId, isActive, role, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const member = await tx.transportPartnerMember.findFirst({ where: { id: memberId, partnerId } });
        if (!member) return { notFound: true };
        const partner = await repository.findPartner(partnerId, tx);
        if (partner?.status === "CLOSED") return { blocker: "PARTNER_CLOSED" };
        const nextIsActive = isActive ?? member.isActive;
        const nextRole = role ?? member.role;
        if (member.isActive === nextIsActive && member.role === nextRole) return { member, unchanged: true };
        if (!member.isActive && nextIsActive) {
          const user = await tx.user.findUnique({
            where: { id: member.userId }, select: { status: true, emailVerifiedAt: true },
          });
          if (user?.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        }
        if (partner?.status === "ACTIVE" && nextIsActive && nextRole !== "OWNER") {
          const eligibleOwners = await tx.transportPartnerMember.count({
            where: {
              partnerId, isActive: true, role: "OWNER", id: { not: member.id },
              user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
            },
          });
          if (!eligibleOwners) return { blocker: "LAST_ACTIVE_OWNER" };
        }
        const removesEligibleOwner = member.isActive && member.role === "OWNER" &&
          (!nextIsActive || nextRole !== "OWNER");
        if (partner?.status === "ACTIVE" && removesEligibleOwner) {
          const memberUser = await tx.user.findUnique({
            where: { id: member.userId }, select: { status: true, emailVerifiedAt: true },
          });
          if (memberUser?.status === "ACTIVE" && memberUser.emailVerifiedAt) {
            const otherOwners = await tx.transportPartnerMember.count({
              where: { partnerId, isActive: true, role: "OWNER", id: { not: member.id }, user: { status: "ACTIVE", emailVerifiedAt: { not: null } } },
            });
            if (!otherOwners) return { blocker: "LAST_ACTIVE_OWNER" };
          }
        }
        const updated = await tx.transportPartnerMember.update({
          where: { id: member.id }, data: { isActive: nextIsActive, role: nextRole },
        });
        const action = member.role !== updated.role
          ? "PARTNER_MEMBER_ROLE_UPDATED"
          : updated.isActive ? "PARTNER_MEMBER_ACTIVATED" : "PARTNER_MEMBER_SUSPENDED";
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "TRANSPORT_PARTNER_MEMBER", entityId: member.id,
          action, reason,
          before: { partnerId, userId: member.userId, role: member.role, isActive: member.isActive },
          after: { partnerId, userId: updated.userId, role: updated.role, isActive: updated.isActive },
        } });
        return { member: updated };
      });
    },

    async assignLeg({ deliveryLegId, partnerId, idempotencyKey, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
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
        if (leg.parcelBooking.integrationClientId && !leg.parcelBooking.integrationDispatchAuthorizedAt) {
          return { blocker: "INTEGRATION_DISPATCH_REVIEW_PENDING" };
        }

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

        if (leg.parcelBooking.integrationClientId
          && leg.parcelBooking.status === "AWAITING_PARTNER_ASSIGNMENT") {
          const bookingChanged = await tx.parcelBooking.updateMany({
            where: {
              id: leg.parcelBookingId,
              integrationClientId: leg.parcelBooking.integrationClientId,
              status: "AWAITING_PARTNER_ASSIGNMENT",
              paymentStatus: "SUCCEEDED",
            },
            data: { status: "DRIVER_ASSIGNED" },
          });
          if (bookingChanged.count !== 1) {
            throw conflict("INTEGRATION_BOOKING_STATE_CONFLICT", "The integration shipment changed before partner assignment could be recorded.");
          }
          const sourceEvent_INTEGRATION_PARTNER_ASSIGNMENT_CREATED = await tx.bookingEvent.create({ data: {
            parcelBookingId: leg.parcelBookingId,
            actorUserId,
            eventType: "INTEGRATION_PARTNER_ASSIGNMENT_CREATED",
            fromStatus: "AWAITING_PARTNER_ASSIGNMENT",
            toStatus: "DRIVER_ASSIGNED",
            metadata: { partnerAssignmentId: assignment.id, deliveryLegId, partnerId, agreementId: agreement.id },
          } });
          await projectIntegrationShipmentEvent({ tx, parcelBookingId: leg.parcelBookingId, sourceEvent: sourceEvent_INTEGRATION_PARTNER_ASSIGNMENT_CREATED });
        }
        return { assignment, replay: false };
      });
    },

    async listMyAssignments({ userId, page = 1, limit = 20 }) {
      const memberships = await repository.findMembershipsForUser(userId);
      const partnerIds = memberships.map(item => item.partnerId);
      if (!partnerIds.length) throw forbidden();
      const result = await repository.listAssignments(partnerIds, {
        skip: (page - 1) * limit,
        take: limit,
      });
      return {
        items: result.items,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      };
    },

    async acceptAssignment({ assignmentId, userId }) {
      return serializableTransaction(prismaClient, async tx => {
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
      return serializableTransaction(prismaClient, async tx => {
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
        if (assignment.deliveryLeg?.parcelBookingId) {
          const booking = await tx.parcelBooking.findUnique({
            where: { id: assignment.deliveryLeg.parcelBookingId },
            select: { id: true, integrationClientId: true, status: true, paymentStatus: true },
          });
          if (booking?.integrationClientId && booking.status === "DRIVER_ASSIGNED") {
            const bookingChanged = await tx.parcelBooking.updateMany({
              where: {
                id: booking.id,
                integrationClientId: booking.integrationClientId,
                status: "DRIVER_ASSIGNED",
                paymentStatus: "SUCCEEDED",
              },
              data: { status: "IN_TRANSIT" },
            });
            if (bookingChanged.count !== 1) {
              throw conflict("INTEGRATION_BOOKING_STATE_CONFLICT", "The integration shipment changed before partner transit could be recorded.");
            }
            const sourceEvent_INTEGRATION_PARTNER_LEG_STARTED = await tx.bookingEvent.create({ data: {
              parcelBookingId: booking.id,
              actorUserId: userId,
              eventType: "INTEGRATION_PARTNER_LEG_STARTED",
              fromStatus: "DRIVER_ASSIGNED",
              toStatus: "IN_TRANSIT",
              metadata: { partnerAssignmentId: assignmentId, deliveryLegId: assignment.deliveryLegId },
            } });
          await projectIntegrationShipmentEvent({ tx, parcelBookingId: booking.id, sourceEvent: sourceEvent_INTEGRATION_PARTNER_LEG_STARTED });
          }
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

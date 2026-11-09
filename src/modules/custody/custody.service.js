import { projectIntegrationShipmentEvent } from "../integrations/integration-shipment-events.projector.js";
import { randomUUID } from "node:crypto";
import { createCustodyRepository } from "./custody.repository.js";

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
const conflict = (code, message) => fail(409, code, message);
const forbidden = () => fail(403, "CUSTODY_PARTY_REQUIRED", "Only an authenticated member of the receiving or releasing party may perform this action.");

async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}

export function createCustodyService({ prismaClient, clock = () => new Date() }) {
  const repo = createCustodyRepository({ prismaClient });

  async function requireActiveUser(tx, userId) {
    const user = await repo.findUser(userId, tx);
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw forbidden();
    return user;
  }

  async function validateParty(tx, { type, id, userId, booking, leg, actor = false }) {
    if (type === "RECIPIENT") {
      const recipient = await repo.findUser(id, tx);
      const normalizePhone = value => {
        const digits = String(value ?? "").replace(/\D/g, "");
        if (digits.length === 13 && digits.startsWith("234")) return `0${digits.slice(3)}`;
        if (digits.length === 10) return `0${digits}`;
        return digits;
      };
      const phoneMatches = normalizePhone(recipient?.phone) !== ""
        && normalizePhone(recipient?.phone) === normalizePhone(booking.recipientPhone);
      if (!recipient || recipient.status !== "ACTIVE" || !recipient.phoneVerifiedAt || !phoneMatches) {
        throw fail(409, "RECIPIENT_VERIFICATION_REQUIRED", "Recipient must have an active account with a verified phone number matching the booking recipient phone.");
      }
      if (actor && recipient.id !== userId) throw forbidden();
      return;
    }
    if (type === "SENDER") {
      const valid = id === booking.senderId;
      if (!valid) throw fail(400, "INVALID_CUSTODY_PARTY", "Sender party must reference the booking sender.");
      if (actor && userId !== booking.senderId) throw forbidden();
      return;
    }
    if (type === "DRIVER") {
      const driver = await repo.findDriverForParty(id, tx);
      const assigned = leg.assignments.some(item => item.driverProfileId === id);
      if (!driver || driver.verificationStatus !== "VERIFIED" || !assigned) throw fail(400, "INVALID_CUSTODY_PARTY", "Driver must be verified and have an active assignment on this delivery leg.");
      if (actor && driver.userId !== userId) throw forbidden();
      return;
    }
    if (type === "HUB") {
      const hub = await repo.findHubForParty(id, tx);
      const legHubIds = [leg.originHubPointId, leg.destinationHubPointId].filter(Boolean);
      if (!hub || hub.status !== "ACTIVE" || !legHubIds.includes(id)) {
        throw fail(400, "INVALID_CUSTODY_PARTY", "Hub must be an active origin or destination hub for this delivery leg.");
      }
      if (actor) {
        const membership = await repo.findHubOperator(id, userId, tx);
        if (!membership?.isActive) throw forbidden();
      }
      return;
    }
    if (type === "TRANSPORT_PARTNER") {
      const partner = await repo.findPartnerForParty(id, tx);
      const assigned = leg.partnerAssignments.some(item => item.partnerId === id);
      if (!partner || partner.status !== "ACTIVE" || partner.verificationStatus !== "VERIFIED" || !assigned) {
        throw fail(400, "INVALID_CUSTODY_PARTY", "Transport partner must be verified and assigned to this delivery leg.");
      }
      if (actor) {
        const membership = await repo.findPartnerMembership(id, userId, tx);
        if (!membership?.isActive) throw forbidden();
      }
      return;
    }
    throw fail(400, "INVALID_CUSTODY_PARTY", "Unsupported custody party type.");
  }

  async function partyProfile(tx, { type, id, userId }) {
    if (type === "DRIVER") {
      const driver = await repo.findDriverForParty(id, tx);
      if (driver?.userId === userId) return true;
    }
    if (type === "SENDER" && id === userId) return true;
    if (type === "HUB") return Boolean((await repo.findHubOperator(id, userId, tx))?.isActive);
    if (type === "TRANSPORT_PARTNER") return Boolean((await repo.findPartnerMembership(id, userId, tx))?.isActive);
    if (type === "RECIPIENT" && id === userId) {
      const recipient = await repo.findUser(id, tx);
      return Boolean(recipient?.status === "ACTIVE" && recipient.phoneVerifiedAt);
    }
    return false;
  }

  return {
    async setRecipientPhoneVerification({ userId, verified, verificationMethod, reason, actorUserId }) {
      return repo.transaction(async tx => {
        const user = await repo.findUser(userId, tx);
        if (!user) return { notFound: true };
        if (user.status !== "ACTIVE") return { blocker: "USER_NOT_ACTIVE" };
        if (verified && !user.phone) return { blocker: "USER_PHONE_REQUIRED" };
        const currentlyVerified = Boolean(user.phoneVerifiedAt);
        if (currentlyVerified === verified) {
          return { user: { id: user.id, phoneVerifiedAt: user.phoneVerifiedAt }, replay: true };
        }
        const phoneVerifiedAt = verified ? clock() : null;
        const updated = await repo.setUserPhoneVerification(userId, phoneVerifiedAt, tx);
        await repo.createAudit({
          actorUserId, entityType: "USER_PHONE_VERIFICATION", entityId: userId,
          action: verified ? "USER_PHONE_VERIFIED_BY_ADMIN" : "USER_PHONE_VERIFICATION_REVOKED",
          before: { phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null },
          after: { phoneVerifiedAt: phoneVerifiedAt?.toISOString() ?? null, verificationMethod, reason },
          reason,
        }, tx);
        return { user: { id: updated.id, phoneVerifiedAt: updated.phoneVerifiedAt }, replay: false };
      });
    },

    async listHubOperators({ hubPointId, page = 1, limit = 25, isActive }) {
      const hub = await repo.findHub(hubPointId);
      if (!hub) return { notFound: true };
      const result = await repo.listHubOperators(hubPointId, {
        skip: (page - 1) * limit, take: limit, isActive,
      });
      return {
        hub: { id: hub.id, name: hub.name, status: hub.status },
        items: result.items,
        pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
      };
    },

    async listHubOperatorsForManager({ hubPointId, userId, page = 1, limit = 25, isActive }) {
      const hub = await repo.findHub(hubPointId);
      if (!hub) return { notFound: true };
      const membership = await repo.findHubOperator(hubPointId, userId);
      if (!membership?.isActive || membership.role !== "MANAGER") return { forbidden: true };
      const result = await repo.listHubOperators(hubPointId, {
        skip: (page - 1) * limit, take: limit, isActive,
      });
      return {
        hub: { id: hub.id, name: hub.name, status: hub.status },
        items: result.items,
        pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
      };
    },

    async addHubStaff({ hubPointId, userId, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const hub = await repo.findHub(hubPointId, tx);
        if (!hub) return { notFound: true };
        if (!["PENDING", "ACTIVE"].includes(hub.status)) return { blocker: "HUB_NOT_OPEN_FOR_STAFF" };

        const managerMembership = await repo.findHubOperator(hubPointId, actorUserId, tx);
        if (!managerMembership?.isActive || managerMembership.role !== "MANAGER") {
          return { forbidden: true };
        }
        if (userId === actorUserId) return { blocker: "SELF_MEMBERSHIP_CHANGE" };

        const user = await repo.findUser(userId, tx);
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };

        const existing = await tx.hubPointOperator.findUnique({
          where: { hubPointId_userId: { hubPointId, userId } },
        });
        if (existing?.isActive && existing.role === "OPERATOR") {
          return { operator: existing, replay: true };
        }
        if (existing?.role === "MANAGER") return { blocker: "MANAGER_MEMBERSHIP_PROTECTED" };
        if (existing && !existing.isActive) return { blocker: "ADMIN_REVIEW_REQUIRED" };

        const operator = await repo.upsertHubOperator({
          hubPointId, userId, role: "OPERATOR", isActive: true, canDispatch: false,
        }, tx);
        await repo.createAudit({
          actorUserId,
          entityType: "HUB_POINT_OPERATOR",
          entityId: operator.id,
          action: "HUB_STAFF_ADDED_BY_MANAGER",
          reason,
          before: null,
          after: { hubPointId, userId, role: "OPERATOR", isActive: true },
        }, tx);
        return { operator, replay: false };
      });
    },

    async addHubOperator({ hubPointId, userId, role = "OPERATOR", reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const hub = await repo.findHub(hubPointId, tx);
        if (!hub) return { notFound: true };
        if (hub.status === "CLOSED") return { blocker: "HUB_CLOSED" };
        const user = await repo.findUser(userId, tx);
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        const existingOperator = await tx.hubPointOperator.findUnique({
          where: { hubPointId_userId: { hubPointId, userId } },
        });
        if (existingOperator?.isActive && existingOperator.role === role) {
          return { operator: existingOperator, replay: true };
        }
        if (hub.status === "ACTIVE" && role !== "MANAGER") {
          const otherManagers = await tx.hubPointOperator.count({
            where: {
              hubPointId, isActive: true, role: "MANAGER",
              ...(existingOperator ? { id: { not: existingOperator.id } } : {}),
              user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
            },
          });
          if (!otherManagers) return { blocker: "LAST_ACTIVE_HUB_MANAGER" };
        }
        const operator = await repo.upsertHubOperator({ hubPointId, userId, role, isActive: true }, tx);
        await repo.createAudit({
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: operator.id,
          action: "HUB_OPERATOR_ACTIVATED",
          reason,
          before: existingOperator ? { role: existingOperator.role, isActive: existingOperator.isActive } : null,
          after: { hubPointId, userId, role: operator.role, isActive: operator.isActive },
        }, tx);
        return { operator };
      });
    },

    async setHubOperatorStatus({ hubPointId, operatorId, isActive, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const current = await repo.findHubOperatorById(hubPointId, operatorId, tx);
        if (!current) return { notFound: true };
        const hub = await repo.findHub(hubPointId, tx);
        if (hub?.status === "CLOSED") return { blocker: "HUB_CLOSED" };
        if (current.isActive === isActive && (isActive || !current.canDispatch)) return { operator: current, replay: true };
        if (isActive) {
          const user = await repo.findUser(current.userId, tx);
          if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        }
        if (current.isActive && current.role === "MANAGER" && !isActive && hub?.status === "ACTIVE") {
          const otherManagers = await tx.hubPointOperator.count({
            where: { hubPointId, isActive: true, role: "MANAGER", id: { not: current.id }, user: { status: "ACTIVE", emailVerifiedAt: { not: null } } },
          });
          if (!otherManagers) return { blocker: "LAST_ACTIVE_HUB_MANAGER" };
        }
        const operator = await repo.updateHubOperator(operatorId, isActive, tx);
        await repo.createAudit({
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: operatorId,
          action: isActive ? "HUB_OPERATOR_ACTIVATED" : "HUB_OPERATOR_SUSPENDED",
          reason,
          before: { isActive: current.isActive, canDispatch: current.canDispatch },
          after: { isActive, canDispatch: operator.canDispatch },
        }, tx);
        return { operator };
      });
    },

    async updateHubOperatorRole({ hubPointId, operatorId, role, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const current = await repo.findHubOperatorById(hubPointId, operatorId, tx);
        if (!current) return { notFound: true };
        const hub = await repo.findHub(hubPointId, tx);
        if (hub?.status === "CLOSED") return { blocker: "HUB_CLOSED" };
        if (current.role === role) return { operator: current, replay: true };
        if (role === "MANAGER" && current.role !== "MANAGER") {
          const user = await repo.findUser(current.userId, tx);
          if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        }
        if (hub?.status === "ACTIVE" && current.isActive && current.role === "MANAGER" && role !== "MANAGER") {
          const otherManagers = await tx.hubPointOperator.count({
            where: {
              hubPointId, isActive: true, role: "MANAGER", id: { not: current.id },
              user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
            },
          });
          if (!otherManagers) return { blocker: "LAST_ACTIVE_HUB_MANAGER" };
        }
        const operator = await tx.hubPointOperator.update({
          where: { id: operatorId }, data: { role, canDispatch: false },
        });
        await repo.createAudit({
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: operatorId,
          action: "HUB_OPERATOR_ROLE_UPDATED", reason,
          before: { role: current.role, isActive: current.isActive, canDispatch: current.canDispatch },
          after: { role: operator.role, isActive: operator.isActive, canDispatch: operator.canDispatch },
        }, tx);
        return { operator, replay: false };
      });
    },

    async setHubOperatorDispatchPermission({ hubPointId, operatorId, canDispatch, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const current = await repo.findHubOperatorById(hubPointId, operatorId, tx);
        if (!current) return { notFound: true };
        if (current.canDispatch === canDispatch) return { operator: current, replay: true };

        if (canDispatch) {
          const hub = await repo.findHub(hubPointId, tx);
          if (!hub || hub.status !== "ACTIVE") return { blocker: "HUB_NOT_ACTIVE" };
          if (!current.isActive) return { blocker: "OPERATOR_NOT_ACTIVE" };
          const user = await repo.findUser(current.userId, tx);
          if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
            return { blocker: "OPERATOR_NOT_ACTIVE" };
          }
        }

        const operator = await repo.updateHubOperatorDispatchPermission(operatorId, canDispatch, tx);
        await repo.createAudit({
          actorUserId,
          entityType: "HUB_POINT_OPERATOR",
          entityId: operatorId,
          action: canDispatch ? "HUB_OPERATOR_DISPATCH_PERMISSION_GRANTED" : "HUB_OPERATOR_DISPATCH_PERMISSION_REVOKED",
          reason,
          before: { role: current.role, isActive: current.isActive, canDispatch: current.canDispatch },
          after: { role: operator.role, isActive: operator.isActive, canDispatch: operator.canDispatch },
        }, tx);
        return { operator, replay: false };
      });
    },

    async createHandover(input, userId) {
      return repo.transaction(async tx => {
        await requireActiveUser(tx, userId);
        await repo.lockDeliveryLeg(input.deliveryLegId, tx);
        const driverPartyId = input.fromPartyType === "DRIVER" ? input.fromPartyId : input.toPartyType === "DRIVER" ? input.toPartyId : null;
        if (driverPartyId) await repo.lockDriverAssignmentForLeg(input.deliveryLegId, driverPartyId, tx);
        const leg = await repo.findBookingLeg(input.deliveryLegId, tx);
        if (!leg || leg.parcelBookingId !== input.parcelBookingId) return { notFound: true };
        const heldDriverAssignment = driverPartyId ? leg.assignments.find(item => item.driverProfileId === driverPartyId && item.executionHoldAt) : null;
        if (heldDriverAssignment) throw fail(409, "ASSIGNMENT_EXECUTION_HELD", "A safety-held assignment cannot initiate or receive an ordinary custody handover. Admin operations must resolve the hold.");
        if (leg.parcelBooking.paymentStatus !== "SUCCEEDED") return { blocker: "BOOKING_NOT_PAID" };
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(leg.status)) return { blocker: "LEG_TERMINAL" };
        if (input.fromPartyType === "TRANSPORT_PARTNER"
          && !leg.partnerAssignments.some(item => item.partnerId === input.fromPartyId && item.status === "IN_TRANSIT")) {
          throw fail(409, "PARTNER_ASSIGNMENT_NOT_IN_TRANSIT", "A transport partner can release custody only after its assignment has started.");
        }
        if (input.fromPartyType === "DRIVER" && input.toPartyType === "HUB"
          && !leg.assignments.some(item => item.driverProfileId === input.fromPartyId && item.status === "ARRIVED_AT_DESTINATION")) {
          throw fail(409, "DRIVER_NOT_ARRIVED_AT_HUB", "A driver can release custody to a hub only after arriving at the assigned destination.");
        }
        if (input.fromPartyType === "HUB" && input.toPartyType === "DRIVER"
          && !leg.assignments.some(item => item.driverProfileId === input.toPartyId && item.status === "ARRIVED_AT_PICKUP")) {
          throw fail(409, "DRIVER_NOT_ARRIVED_AT_HUB", "A hub can release custody only to a driver who has arrived at pickup.");
        }
        if (input.fromPartyType === "HUB" && input.toPartyType === "TRANSPORT_PARTNER"
          && !leg.partnerAssignments.some(item => item.partnerId === input.toPartyId && item.status === "ACCEPTED")) {
          throw fail(409, "PARTNER_NOT_READY_FOR_HANDOVER", "A hub can release custody only to a partner that has accepted the assignment.");
        }
        await validateParty(tx, { type: input.fromPartyType, id: input.fromPartyId, userId, booking: leg.parcelBooking, leg, actor: true });
        await validateParty(tx, { type: input.toPartyType, id: input.toPartyId, userId, booking: leg.parcelBooking, leg });
        if (input.fromPartyType === input.toPartyType && input.fromPartyId === input.toPartyId) {
          return { blocker: "SAME_CUSTODY_PARTY" };
        }
        if (input.fromPartyType === "HUB") {
          const intake = await repo.findReceivedHubIntake(leg.parcelBookingId, input.fromPartyId, tx);
          if (!intake) return { blocker: "HUB_INTAKE_REQUIRED" };
        }
        if (input.fromPartyType === "HUB") {
          const blockingCase = await repo.findBlockingHubOperationalCase(leg.id, tx);
          if (blockingCase) return { blocker: "HUB_OPERATIONAL_CASE_OPEN", operationalCaseId: blockingCase.id };
        }
        const pending = await repo.findPendingHandover(leg.id, tx);
        if (pending && pending.expiresAt && pending.expiresAt <= clock()) {
          await repo.updateHandover(pending.id, { status: "EXPIRED" }, tx);
        } else if (pending) {
          return { blocker: "HANDOVER_ALREADY_PENDING" };
        }
        const partyHubId = input.fromPartyType === "HUB" ? input.fromPartyId : input.toPartyType === "HUB" ? input.toPartyId : null;
        if (input.hubPointId && input.hubPointId !== partyHubId) {
          return { blocker: "HANDOVER_HUB_MISMATCH" };
        }
        const hubPointId = partyHubId;
        const handover = await repo.createHandover({
          parcelBookingId: leg.parcelBookingId,
          deliveryLegId: leg.id,
          hubPointId,
          fromPartyType: input.fromPartyType,
          fromPartyId: input.fromPartyId,
          toPartyType: input.toPartyType,
          toPartyId: input.toPartyId,
          initiatedByUserId: userId,
          conditionAtRelease: input.conditionAtRelease,
          evidence: input.evidence ?? undefined,
          expiresAt: new Date(clock().getTime() + 24 * 60 * 60 * 1000),
        }, tx);
        await repo.createAudit({
          actorUserId: userId, entityType: "CUSTODY_HANDOVER", entityId: handover.id,
          action: "CUSTODY_HANDOVER_INITIATED",
          after: { status: handover.status, fromPartyType: handover.fromPartyType, fromPartyId: handover.fromPartyId, toPartyType: handover.toPartyType, toPartyId: handover.toPartyId },
        }, tx);
        return { handover };
      });
    },

    async confirmHandover({ handoverId, userId, conditionAtReceipt, evidence, rejectReason, weightGrams, lengthMm, widthMm, heightMm }) {
      return serializableTransaction(prismaClient, async tx => {
        await requireActiveUser(tx, userId);
        await repo.lockHandover(handoverId, tx);
        const handover = await repo.findHandover(handoverId, tx);
        if (!handover) return { notFound: true };
        await repo.lockDeliveryLeg(handover.deliveryLegId, tx);
        const handoverDriverPartyId = handover.fromPartyType === "DRIVER" ? handover.fromPartyId : handover.toPartyType === "DRIVER" ? handover.toPartyId : null;
        if (handoverDriverPartyId) await repo.lockDriverAssignmentForLeg(handover.deliveryLegId, handoverDriverPartyId, tx);
        const handoverLeg = await repo.findBookingLeg(handover.deliveryLegId, tx);
        const heldHandoverAssignment = handoverDriverPartyId ? handoverLeg?.assignments.find(item => item.driverProfileId === handoverDriverPartyId && item.executionHoldAt) : null;
        if (heldHandoverAssignment) throw fail(409, "ASSIGNMENT_EXECUTION_HELD", "A safety-held assignment cannot confirm an ordinary custody handover. Admin operations must resolve the hold.");
        if (handover.status !== "PENDING_CONFIRMATION") return { blocker: "HANDOVER_NOT_PENDING" };
        if (handover.expiresAt && handover.expiresAt <= clock()) {
          await repo.updateHandover(handoverId, { status: "EXPIRED" }, tx);
          await repo.createAudit({ actorUserId: userId, entityType: "CUSTODY_HANDOVER", entityId: handoverId, action: "CUSTODY_HANDOVER_EXPIRED", before: { status: handover.status }, after: { status: "EXPIRED" } }, tx);
          return { blocker: "HANDOVER_EXPIRED" };
        }
        if (handover.initiatedByUserId === userId) throw conflict("HANDOVER_SELF_CONFIRMATION", "The releasing user cannot confirm their own custody handover.");
        await validateParty(tx, {
          type: handover.toPartyType, id: handover.toPartyId, userId,
          booking: handover.parcelBooking, leg: await repo.findBookingLeg(handover.deliveryLegId, tx), actor: true,
        });
        if (rejectReason) {
          const updated = await repo.updateHandover(handoverId, {
            status: "REJECTED", rejectedAt: clock(), rejectionReason: rejectReason,
            conditionAtReceipt: conditionAtReceipt ?? null,
            evidence: evidence ?? handover.evidence ?? undefined,
          }, tx);
          const operationalCase = await repo.createOperationalCase({
            publicReference: `CASE-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
            type: "FAILED_HANDOVER", status: "OPEN", priority: "HIGH",
            parcelBookingId: handover.parcelBookingId, deliveryLegId: handover.deliveryLegId,
            custodyHandoverId: handover.id, hubPointId: handover.hubPointId,
            reportedByUserId: userId, title: "Custody handover rejected",
            description: rejectReason, evidence: evidence ?? handover.evidence ?? undefined,
          }, tx);
          await repo.createAudit({
            actorUserId: userId, entityType: "CUSTODY_HANDOVER", entityId: handoverId,
            action: "CUSTODY_HANDOVER_REJECTED",
            before: { status: handover.status }, after: { status: updated.status, operationalCaseId: operationalCase.id, rejectionReason: rejectReason },
          }, tx);
          return { handover: updated, operationalCase };
        }
        if (handover.toPartyType === "HUB") {
          if (!Number.isInteger(weightGrams) || weightGrams <= 0) {
            throw fail(409, "HUB_INTAKE_WEIGHT_REQUIRED", "A positive measured parcel weight in grams is required before a hub can confirm intake.");
          }
          const hasAnyDimension = [lengthMm, widthMm, heightMm].some(value => value !== undefined);
          const hasAllDimensions = [lengthMm, widthMm, heightMm].every(value => Number.isInteger(value) && value > 0);
          if (hasAnyDimension && !hasAllDimensions) {
            throw fail(409, "HUB_INTAKE_DIMENSIONS_INCOMPLETE", "Provide all three positive parcel dimensions in millimetres, or leave all dimensions blank.");
          }
          await repo.lockHubCapacity(handover.toPartyId, tx);
          const existingIntake = await repo.findReceivedHubIntake(handover.parcelBookingId, handover.toPartyId, tx);
          if (existingIntake) throw fail(409, "HUB_INTAKE_ALREADY_ACTIVE", "This parcel already has an active intake record at the receiving hub.");
          const hub = await repo.findHubIntakeConfig(handover.toPartyId, tx);
          if (!hub || hub.status !== "ACTIVE") throw fail(409, "HUB_NOT_ACTIVE", "The receiving hub is not active.");
          const acceptedTypes = Array.isArray(hub.acceptedParcelTypes) ? hub.acceptedParcelTypes : [];
          if (acceptedTypes.length && !acceptedTypes.includes(handover.parcelBooking.parcelCategory)) {
            throw fail(409, "HUB_PARCEL_TYPE_NOT_ACCEPTED", "This hub does not accept the parcel category on this booking.");
          }
          const capacity = hub.capacityConfig && typeof hub.capacityConfig === "object" ? hub.capacityConfig : {};
          const currentCount = await repo.countReceivedHubIntakes(hub.id, tx);
          if (Number.isInteger(capacity.maxParcels) && currentCount >= capacity.maxParcels) {
            throw fail(409, "HUB_PARCEL_CAPACITY_EXCEEDED", "The hub has reached its active parcel capacity.");
          }
          const totals = await repo.aggregateReceivedHubIntakes(hub.id, tx);
          const currentWeight = Number(totals._sum.weightGrams ?? 0);
          if (Number.isInteger(capacity.maxWeightGrams) && currentWeight + weightGrams > capacity.maxWeightGrams) {
            throw fail(409, "HUB_WEIGHT_CAPACITY_EXCEEDED", "Receiving this parcel would exceed the hub's configured weight capacity.");
          }
          let volumeCm3 = null;
          if (hasAllDimensions) volumeCm3 = Math.ceil((lengthMm * widthMm * heightMm) / 1000);
          if (Number.isInteger(capacity.maxVolumeCm3)) {
            if (volumeCm3 === null) throw fail(409, "HUB_INTAKE_DIMENSIONS_REQUIRED", "This hub requires parcel dimensions to enforce its configured volume capacity.");
            const currentVolume = Number(totals._sum.volumeCm3 ?? 0);
            if (currentVolume + volumeCm3 > capacity.maxVolumeCm3) {
              throw fail(409, "HUB_VOLUME_CAPACITY_EXCEEDED", "Receiving this parcel would exceed the hub's configured volume capacity.");
            }
          }
          await repo.createHubIntakeRecord({
            parcelBookingId: handover.parcelBookingId,
            deliveryLegId: handover.deliveryLegId,
            hubPointId: handover.toPartyId,
            receivedByUserId: userId,
            status: "RECEIVED",
            weightGrams,
            ...(hasAllDimensions ? { lengthMm, widthMm, heightMm, volumeCm3 } : {}),
            conditionAtReceipt: conditionAtReceipt ?? handover.conditionAtRelease,
            evidence: evidence ?? handover.evidence ?? undefined,
          }, tx);
        }

        const updated = await repo.updateHandover(handoverId, {
          status: "CONFIRMED", confirmedByUserId: userId, confirmedAt: clock(),
          conditionAtReceipt: conditionAtReceipt ?? handover.conditionAtRelease,
          evidence: evidence ?? handover.evidence ?? undefined,
        }, tx);

        const confirmedLeg = await repo.findBookingLeg(handover.deliveryLegId, tx);

        if (handover.fromPartyType === "TRANSPORT_PARTNER" && handover.toPartyType === "RECIPIENT"
          && !(confirmedLeg?.type === "INTERSTATE_TRANSPORT"
            && confirmedLeg?.destinationHubPointId == null
            && Boolean(handover.parcelBooking?.integrationClientId))) {
          throw fail(409, "PARTNER_RECIPIENT_HANDOVER_NOT_SUPPORTED", "Direct partner-to-recipient completion is reserved for integration end-to-end shipments without a destination hub.");
        }

        if (handover.fromPartyType === "HUB" && ["DRIVER", "TRANSPORT_PARTNER"].includes(handover.toPartyType)) {
          const blockingCase = await repo.findBlockingHubOperationalCase(handover.deliveryLegId, tx);
          if (blockingCase) throw fail(409, "HUB_OPERATIONAL_CASE_OPEN", "This parcel has an unresolved operational exception. Resolve or close the case before releasing custody.");
          const intake = await repo.findReceivedHubIntake(handover.parcelBookingId, handover.fromPartyId, tx);
          if (!intake) throw fail(409, "HUB_INTAKE_REQUIRED", "The hub cannot release a parcel that has no active intake record.");
          const recovery = await repo.findHubRecoveryForIntake(intake.id, tx);
          if (recovery) {
            const disposition = await repo.findHubIntakeDisposition(intake.id, tx);
            if (disposition?.status !== "ROUTE_APPROVED" || disposition.nextDeliveryLegId !== handover.deliveryLegId) {
              throw fail(409, "HUB_RECOVERY_DISPOSITION_REQUIRED", "A safety-recovered parcel can only be released on its explicitly approved continuation leg.");
            }
            await repo.updateHubIntakeDisposition(disposition.id, {
              status: "RELEASED", releasedAt: clock(), releasedByUserId: handover.initiatedByUserId,
            }, tx);
          }
          await repo.updateHubIntakeRecord(intake.id, { status: "RELEASED", releasedAt: clock() }, tx);
        }

        // Hub release to a driver is the pickup custody confirmation for that assignment.
        if (handover.fromPartyType === "HUB" && handover.toPartyType === "DRIVER"
          && confirmedLeg?.originHubPointId === handover.fromPartyId) {
          const assignment = await tx.driverAssignment.findFirst({
            where: { deliveryLegId: handover.deliveryLegId, driverProfileId: handover.toPartyId, status: "ARRIVED_AT_PICKUP" },
          });
          if (!assignment) throw fail(409, "DRIVER_PICKUP_STATE_CONFLICT", "The receiving driver is no longer awaiting pickup custody.");
          const changed = await tx.driverAssignment.updateMany({
            where: { id: assignment.id, status: "ARRIVED_AT_PICKUP" },
            data: { status: "PICKUP_CONFIRMED", pickupAt: clock() },
          });
          if (changed.count !== 1) throw fail(409, "DRIVER_PICKUP_STATE_CONFLICT", "The driver pickup state changed before custody was confirmed.");
          const sourceEvent_HUB_PICKUP_CUSTODY_CONFIRMED = await tx.bookingEvent.create({
            data: {
              parcelBookingId: handover.parcelBookingId,
              actorUserId: userId,
              eventType: "HUB_PICKUP_CUSTODY_CONFIRMED",
              fromStatus: "ARRIVED_AT_PICKUP",
              toStatus: "PICKUP_CONFIRMED",
              metadata: { assignmentId: assignment.id, deliveryLegId: handover.deliveryLegId, handoverId },
            },
          });
          await projectIntegrationShipmentEvent({ tx, parcelBookingId: handover.parcelBookingId, sourceEvent: sourceEvent_HUB_PICKUP_CUSTODY_CONFIRMED });
          await repo.createAudit({
            actorUserId: userId, entityType: "DRIVER_ASSIGNMENT", entityId: assignment.id,
            action: "HUB_CUSTODY_RELEASE_CONFIRMED",
            before: { status: "ARRIVED_AT_PICKUP" }, after: { status: "PICKUP_CONFIRMED", handoverId },
          }, tx);
        }

        // Driver delivery into a hub completes this leg and activates the next planned leg.
        if (handover.fromPartyType === "DRIVER" && handover.toPartyType === "HUB"
          && confirmedLeg?.destinationHubPointId === handover.toPartyId) {
          const assignment = await tx.driverAssignment.findFirst({
            where: { deliveryLegId: handover.deliveryLegId, driverProfileId: handover.fromPartyId, status: "ARRIVED_AT_DESTINATION" },
          });
          if (!assignment) throw fail(409, "DRIVER_DESTINATION_STATE_CONFLICT", "The driver assignment is no longer awaiting destination custody.");
          const completedAt = clock();
          const assignmentChanged = await tx.driverAssignment.updateMany({
            where: { id: assignment.id, status: "ARRIVED_AT_DESTINATION" },
            data: { status: "COMPLETED", completedAt },
          });
          if (assignmentChanged.count !== 1) throw fail(409, "DRIVER_DESTINATION_STATE_CONFLICT", "The driver assignment changed before custody was confirmed.");
          const legChanged = await tx.deliveryLeg.updateMany({
            where: { id: handover.deliveryLegId, status: "DELIVERY_VERIFICATION_PENDING" },
            data: { status: "COMPLETED", completedAt },
          });
          if (legChanged.count !== 1) throw fail(409, "DRIVER_LEG_COMPLETION_CONFLICT", "The delivery leg is no longer awaiting hub receipt.");
          await tx.driverProfile.update({
            where: { id: assignment.driverProfileId },
            data: { isAvailable: true, completedJobs: { increment: 1 } },
          });
          if (!assignment.payoutReviewRequired) {
            await tx.driverPayout.upsert({
              where: { idempotencyKey: "completion-" + assignment.id },
              create: {
                driverProfileId: assignment.driverProfileId,
                parcelBookingId: handover.parcelBookingId,
                amountMinor: assignment.agreedFareMinor,
                currency: assignment.currency,
                status: "PENDING",
                provider: "PAYSTACK",
                idempotencyKey: "completion-" + assignment.id,
              },
              update: {},
            });
          }
          const nextLeg = await tx.deliveryLeg.findFirst({
            where: { parcelBookingId: handover.parcelBookingId, sequence: { gt: confirmedLeg.sequence } },
            orderBy: { sequence: "asc" },
            select: { id: true, status: true },
          });
          if (nextLeg?.status === "PLANNED") {
            const activated = await tx.deliveryLeg.updateMany({
              where: { id: nextLeg.id, status: "PLANNED" },
              data: { status: "READY_FOR_ASSIGNMENT" },
            });
            if (activated.count !== 1) throw fail(409, "DELIVERY_LEG_SEQUENCE_CONFLICT", "The next delivery leg could not be activated.");
          } else if (nextLeg && nextLeg.status !== "READY_FOR_ASSIGNMENT") {
            throw fail(409, "DELIVERY_LEG_SEQUENCE_CONFLICT", "The next delivery leg is not ready for activation.");
          }
          await tx.parcelBooking.update({
            where: { id: handover.parcelBookingId },
            data: { status: "IN_TRANSIT" },
          });
          const sourceEvent_HUB_DESTINATION_CUSTODY_CONFIRMED = await tx.bookingEvent.create({
            data: {
              parcelBookingId: handover.parcelBookingId,
              actorUserId: userId,
              eventType: "HUB_DESTINATION_CUSTODY_CONFIRMED",
              fromStatus: "DELIVERY_VERIFICATION_PENDING",
              toStatus: "COMPLETED",
              metadata: { assignmentId: assignment.id, deliveryLegId: handover.deliveryLegId, nextDeliveryLegId: nextLeg?.id ?? null, handoverId },
            },
          });
          await projectIntegrationShipmentEvent({ tx, parcelBookingId: handover.parcelBookingId, sourceEvent: sourceEvent_HUB_DESTINATION_CUSTODY_CONFIRMED });
        }

        // A partner interstate leg completes at a destination hub, or directly with the
        // verified recipient for an integration end-to-end shipment with no destination hub.
        const partnerRecipientCompletion = handover.fromPartyType === "TRANSPORT_PARTNER"
          && handover.toPartyType === "RECIPIENT"
          && confirmedLeg?.type === "INTERSTATE_TRANSPORT"
          && confirmedLeg?.destinationHubPointId == null
          && Boolean(handover.parcelBooking?.integrationClientId);
        const partnerHubCompletion = handover.fromPartyType === "TRANSPORT_PARTNER"
          && handover.toPartyType === "HUB"
          && confirmedLeg?.destinationHubPointId === handover.toPartyId;
        if (partnerHubCompletion || partnerRecipientCompletion) {
          if (partnerRecipientCompletion) {
            const laterLeg = await tx.deliveryLeg.findFirst({
              where: { parcelBookingId: handover.parcelBookingId, sequence: { gt: confirmedLeg.sequence } },
              select: { id: true, status: true },
            });
            if (laterLeg) {
              throw fail(409, "RECIPIENT_HANDOVER_NOT_TERMINAL", "An integration shipment can be delivered directly to its recipient only on its final delivery leg.");
            }
          }
          const assignment = await tx.partnerDeliveryAssignment.findFirst({
            where: { deliveryLegId: handover.deliveryLegId, partnerId: handover.fromPartyId, status: "IN_TRANSIT" },
          });
          if (!assignment) {
            throw fail(409, "PARTNER_ASSIGNMENT_NOT_IN_TRANSIT", "The partner assignment is no longer in transit and recipient delivery cannot be completed.");
          }
          if (assignment) {
            const completedAt = clock();
            const changed = await tx.partnerDeliveryAssignment.updateMany({
              where: { id: assignment.id, status: "IN_TRANSIT" },
              data: { status: "COMPLETED", completedAt },
            });
            if (changed.count === 1) {
              const legChanged = await tx.deliveryLeg.updateMany({
                where: { id: handover.deliveryLegId, status: "IN_TRANSIT" },
                data: { status: "COMPLETED", completedAt },
              });
              if (legChanged.count !== 1) {
                throw fail(409, "PARTNER_LEG_COMPLETION_CONFLICT", "The delivery leg is no longer in transit and partner completion cannot be recorded.");
              }
              const payable = await tx.partnerPayable.upsert({
                where: { partnerDeliveryAssignmentId: assignment.id },
                create: {
                  partnerId: assignment.partnerId,
                  partnerDeliveryAssignmentId: assignment.id,
                  agreementId: assignment.agreementId,
                  deliveryLegId: assignment.deliveryLegId,
                  sourceChargeMinor: assignment.agreedTransportChargeMinor,
                  amountMinor: assignment.agreedTransportChargeMinor,
                  currency: assignment.currency,
                },
                update: {},
              });
              const nextLeg = await tx.deliveryLeg.findFirst({
                where: { parcelBookingId: handover.parcelBookingId, sequence: { gt: confirmedLeg.sequence } },
                orderBy: { sequence: "asc" },
                select: { id: true, status: true },
              });
              if (nextLeg?.status === "PLANNED") {
                const activated = await tx.deliveryLeg.updateMany({
                  where: { id: nextLeg.id, status: "PLANNED" },
                  data: { status: "READY_FOR_ASSIGNMENT" },
                });
                if (activated.count !== 1) throw fail(409, "DELIVERY_LEG_SEQUENCE_CONFLICT", "The next delivery leg could not be activated.");
              } else if (nextLeg && nextLeg.status !== "READY_FOR_ASSIGNMENT") {
                throw fail(409, "DELIVERY_LEG_SEQUENCE_CONFLICT", "The next delivery leg is not ready for activation.");
              }
              const deliveredToRecipient = partnerRecipientCompletion;
              await tx.parcelBooking.update({
                where: { id: handover.parcelBookingId },
                data: { status: deliveredToRecipient ? "COMPLETED" : "IN_TRANSIT" },
              });
              const completionEventType = deliveredToRecipient
                ? "PARTNER_RECIPIENT_CUSTODY_CONFIRMED"
                : "PARTNER_HUB_CUSTODY_CONFIRMED";
              const sourceEvent_PARTNER_CUSTODY_CONFIRMED = await tx.bookingEvent.create({
                data: {
                  parcelBookingId: handover.parcelBookingId,
                  actorUserId: userId,
                  eventType: completionEventType,
                  fromStatus: "IN_TRANSIT",
                  toStatus: "COMPLETED",
                  metadata: {
                    partnerAssignmentId: assignment.id,
                    deliveryLegId: handover.deliveryLegId,
                    nextDeliveryLegId: nextLeg?.id ?? null,
                    handoverId,
                    receivingPartyType: handover.toPartyType,
                    receivingPartyId: handover.toPartyId,
                  },
                },
              });
              await projectIntegrationShipmentEvent({
                tx,
                parcelBookingId: handover.parcelBookingId,
                sourceEvent: sourceEvent_PARTNER_CUSTODY_CONFIRMED,
              });
              await repo.createAudit({
                actorUserId: userId, entityType: "PARTNER_DELIVERY_ASSIGNMENT",
                entityId: assignment.id, action: "PARTNER_EXECUTION_COMPLETED_AND_PAYABLE_CREATED",
                before: { status: assignment.status },
                after: { status: "COMPLETED", payableId: payable.id, amountMinor: payable.amountMinor.toString(), currency: payable.currency },
              }, tx);
            } else {
              throw fail(409, "PARTNER_ASSIGNMENT_COMPLETION_CONFLICT", "The partner assignment changed before delivery completion could be recorded.");
            }
          }
        }


        await repo.createAudit({
          actorUserId: userId, entityType: "CUSTODY_HANDOVER", entityId: handoverId,
          action: "CUSTODY_HANDOVER_CONFIRMED",
          before: { status: handover.status }, after: { status: updated.status, confirmedByUserId: userId },
        }, tx);
        return { handover: updated };
      });
    },

    async initiateAdminHubRecovery({ assignmentId, hubPointId, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        await requireActiveUser(tx, actorUserId);
        const initialAssignment = await repo.findHubRecoveryAssignment(assignmentId, tx);
        if (!initialAssignment) return { notFound: true };
        if (!initialAssignment.deliveryLegId) return { blocker: "PARCEL_ASSIGNMENT_REQUIRED" };
        // Match custody handover lock ordering: delivery leg first, then assignment.
        await repo.lockDeliveryLeg(initialAssignment.deliveryLegId, tx);
        await repo.lockDriverAssignment(assignmentId, tx);
        const assignment = await repo.findHubRecoveryAssignment(assignmentId, tx);
        if (!assignment) return { notFound: true };
        if (assignment.deliveryLegId !== initialAssignment.deliveryLegId) {
          return { blocker: "SOURCE_ASSIGNMENT_RECOVERY_STATE_CHANGED" };
        }
        if (!assignment.parcelBookingId || !assignment.deliveryLegId || !assignment.parcelBooking || !assignment.deliveryLeg) {
          return { blocker: "PARCEL_ASSIGNMENT_REQUIRED" };
        }
        if (assignment.parcelBooking.paymentStatus !== "SUCCEEDED") return { blocker: "BOOKING_NOT_PAID" };
        if (!assignment.pickupAt || !["PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"].includes(assignment.status)) {
          return { blocker: "ASSIGNMENT_NOT_IN_CUSTODY" };
        }
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(assignment.deliveryLeg.status)) return { blocker: "DELIVERY_LEG_TERMINAL" };
        if (await repo.findPendingHandover(assignment.deliveryLegId, tx)) return { blocker: "PENDING_CUSTODY_HANDOVER_EXISTS" };
        if (await repo.findAnyReceivedHubIntake(assignment.parcelBookingId, tx)) return { blocker: "PARCEL_ALREADY_IN_HUB_CUSTODY" };
        if (!assignment.executionHoldAt || !assignment.executionHoldOperationalCaseId) {
          return { blocker: "ACTIVE_SAFETY_HOLD_REQUIRED" };
        }
        const safetyCase = await tx.operationalCase.findUnique({
          where: { id: assignment.executionHoldOperationalCaseId },
        });
        if (!safetyCase || safetyCase.type !== "SAFETY_INCIDENT"
          || !["OPEN", "TRIAGED", "IN_PROGRESS"].includes(safetyCase.status)
          || safetyCase.parcelBookingId !== assignment.parcelBookingId
          || safetyCase.deliveryLegId !== assignment.deliveryLegId) {
          return { blocker: "ACTIVE_SAFETY_CASE_REQUIRED" };
        }
        const existingDriverRecovery = await repo.findActiveDriverRecovery(assignmentId, tx);
        if (existingDriverRecovery) return { blocker: "DRIVER_RECOVERY_ALREADY_ACTIVE" };
        const activeRecovery = await repo.findActiveHubRecovery(assignmentId, tx);
        if (activeRecovery) {
          if (activeRecovery.hubPointId !== hubPointId) return { blocker: "HUB_RECOVERY_ALREADY_ACTIVE" };
          return { recovery: activeRecovery, replay: true };
        }
        const hub = await repo.findHubIntakeConfig(hubPointId, tx);
        if (!hub) return { hubNotFound: true };
        if (hub.status !== "ACTIVE") return { blocker: "HUB_NOT_ACTIVE" };
        if (![assignment.deliveryLeg.originServiceZoneId, assignment.deliveryLeg.destinationServiceZoneId].includes(hub.serviceZoneId)) {
          return { blocker: "HUB_OUTSIDE_LEG_SERVICE_ZONES" };
        }
        const recovery = await repo.createHubRecovery({
          parcelBookingId: assignment.parcelBookingId,
          deliveryLegId: assignment.deliveryLegId,
          sourceAssignmentId: assignment.id,
          hubPointId,
          operationalCaseId: safetyCase.id,
          initiatedByUserId: actorUserId,
          status: "PENDING_RECEIPT",
          reason,
        }, tx);
        await repo.createAudit({
          actorUserId,
          entityType: "DRIVER_ASSIGNMENT_HUB_RECOVERY",
          entityId: recovery.id,
          action: "DRIVER_ASSIGNMENT_HUB_RECOVERY_AUTHORIZED",
          reason,
          before: { assignmentStatus: assignment.status, executionHoldAt: assignment.executionHoldAt },
          after: {
            status: recovery.status, sourceAssignmentId: assignment.id,
            parcelBookingId: assignment.parcelBookingId, deliveryLegId: assignment.deliveryLegId,
            hubPointId, operationalCaseId: safetyCase.id,
          },
        }, tx);
        return { recovery, replay: false };
      });
    },

    async receiveAdminHubRecovery({ recoveryId, userId, conditionAtReceipt, weightGrams, lengthMm, widthMm, heightMm, evidence }) {
      return serializableTransaction(prismaClient, async tx => {
        await requireActiveUser(tx, userId);
        await repo.lockHubRecovery(recoveryId, tx);
        const recovery = await repo.findHubRecovery(recoveryId, tx);
        if (!recovery) return { notFound: true };
        const membership = await repo.findHubOperator(recovery.hubPointId, userId, tx);
        if (!membership?.isActive) throw forbidden();
        if (recovery.status === "CONFIRMED") return { recovery, replay: true };
        if (recovery.status !== "PENDING_RECEIPT") return { blocker: "HUB_RECOVERY_NOT_RECEIVABLE" };

        // Keep the same leg -> assignment lock order used by normal custody handovers.
        await repo.lockDeliveryLeg(recovery.deliveryLegId, tx);
        await repo.lockDriverAssignment(recovery.sourceAssignmentId, tx);
        const assignment = await repo.findHubRecoveryAssignment(recovery.sourceAssignmentId, tx);
        if (!assignment || assignment.id !== recovery.sourceAssignmentId) return { blocker: "SOURCE_ASSIGNMENT_UNAVAILABLE" };
        if (assignment.parcelBookingId !== recovery.parcelBookingId
          || assignment.deliveryLegId !== recovery.deliveryLegId
          || !assignment.pickupAt
          || !["PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"].includes(assignment.status)
          || !assignment.executionHoldAt
          || assignment.executionHoldOperationalCaseId !== recovery.operationalCaseId) {
          return { blocker: "SOURCE_ASSIGNMENT_RECOVERY_STATE_CHANGED" };
        }
        if (assignment.parcelBooking?.paymentStatus !== "SUCCEEDED") return { blocker: "BOOKING_NOT_PAID" };
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(assignment.deliveryLeg.status)) return { blocker: "DELIVERY_LEG_TERMINAL" };
        if (await repo.findPendingHandover(assignment.deliveryLegId, tx)) return { blocker: "PENDING_CUSTODY_HANDOVER_EXISTS" };
        const activeIntake = await repo.findAnyReceivedHubIntake(recovery.parcelBookingId, tx);
        if (activeIntake) return { blocker: "PARCEL_ALREADY_IN_HUB_CUSTODY" };
        const safetyCase = await tx.operationalCase.findUnique({ where: { id: recovery.operationalCaseId } });
        if (!safetyCase || safetyCase.type !== "SAFETY_INCIDENT"
          || !["OPEN", "TRIAGED", "IN_PROGRESS"].includes(safetyCase.status)
          || safetyCase.parcelBookingId !== recovery.parcelBookingId
          || safetyCase.deliveryLegId !== recovery.deliveryLegId) {
          return { blocker: "ACTIVE_SAFETY_CASE_REQUIRED" };
        }
        if (!Number.isInteger(weightGrams) || weightGrams <= 0) {
          throw fail(400, "HUB_INTAKE_WEIGHT_REQUIRED", "A positive measured parcel weight in grams is required.");
        }
        const hasAnyDimension = [lengthMm, widthMm, heightMm].some(value => value !== undefined);
        const hasAllDimensions = [lengthMm, widthMm, heightMm].every(value => Number.isInteger(value) && value > 0);
        if (hasAnyDimension && !hasAllDimensions) {
          throw fail(400, "HUB_INTAKE_DIMENSIONS_INCOMPLETE", "Provide all three positive parcel dimensions, or leave all dimensions blank.");
        }

        await repo.lockHubCapacity(recovery.hubPointId, tx);
        const hub = await repo.findHubIntakeConfig(recovery.hubPointId, tx);
        if (!hub || hub.status !== "ACTIVE") return { blocker: "HUB_NOT_ACTIVE" };
        if (![assignment.deliveryLeg.originServiceZoneId, assignment.deliveryLeg.destinationServiceZoneId].includes(hub.serviceZoneId)) {
          return { blocker: "HUB_OUTSIDE_LEG_SERVICE_ZONES" };
        }
        const acceptedTypes = Array.isArray(hub.acceptedParcelTypes) ? hub.acceptedParcelTypes : [];
        if (acceptedTypes.length && !acceptedTypes.includes(assignment.parcelBooking.parcelCategory)) {
          return { blocker: "HUB_PARCEL_TYPE_NOT_ACCEPTED" };
        }
        const existingIntake = await repo.findReceivedHubIntake(recovery.parcelBookingId, recovery.hubPointId, tx);
        if (existingIntake) return { blocker: "HUB_INTAKE_ALREADY_ACTIVE" };

        const capacity = hub.capacityConfig && typeof hub.capacityConfig === "object" ? hub.capacityConfig : {};
        const currentCount = await repo.countReceivedHubIntakes(hub.id, tx);
        if (Number.isInteger(capacity.maxParcels) && currentCount >= capacity.maxParcels) {
          return { blocker: "HUB_PARCEL_CAPACITY_EXCEEDED" };
        }
        const totals = await repo.aggregateReceivedHubIntakes(hub.id, tx);
        const currentWeight = Number(totals._sum.weightGrams ?? 0);
        if (Number.isInteger(capacity.maxWeightGrams) && currentWeight + weightGrams > capacity.maxWeightGrams) {
          return { blocker: "HUB_WEIGHT_CAPACITY_EXCEEDED" };
        }
        let volumeCm3 = null;
        if (hasAllDimensions) {
          const volumeCm3BigInt = (BigInt(lengthMm) * BigInt(widthMm) * BigInt(heightMm) + 999n) / 1000n;
          if (volumeCm3BigInt > 2147483647n) {
            throw fail(400, "HUB_INTAKE_DIMENSIONS_OUT_OF_RANGE", "The measured parcel volume exceeds the supported hub intake range.");
          }
          volumeCm3 = Number(volumeCm3BigInt);
        }
        if (Number.isInteger(capacity.maxVolumeCm3)) {
          if (volumeCm3 === null) return { blocker: "HUB_INTAKE_DIMENSIONS_REQUIRED" };
          const currentVolume = Number(totals._sum.volumeCm3 ?? 0);
          if (currentVolume + volumeCm3 > capacity.maxVolumeCm3) return { blocker: "HUB_VOLUME_CAPACITY_EXCEEDED" };
        }

        const intake = await repo.createHubIntakeRecord({
          parcelBookingId: recovery.parcelBookingId,
          deliveryLegId: recovery.deliveryLegId,
          hubPointId: recovery.hubPointId,
          receivedByUserId: userId,
          status: "RECEIVED",
          weightGrams,
          ...(hasAllDimensions ? { lengthMm, widthMm, heightMm, volumeCm3 } : {}),
          conditionAtReceipt,
          evidence: evidence ?? undefined,
        }, tx);
        const retired = await tx.driverAssignment.updateMany({
          where: {
            id: assignment.id,
            status: { in: ["PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"] },
            pickupAt: { not: null },
            executionHoldAt: { not: null },
            executionHoldOperationalCaseId: recovery.operationalCaseId,
          },
          data: {
            status: "FAILED",
            failureReason: "HUB_CUSTODY_RECOVERY_RECEIVED",
            payoutReviewRequired: true,
            executionHoldAt: null,
          },
        });
        if (retired.count !== 1) throw conflict("SOURCE_ASSIGNMENT_RECOVERY_STATE_CHANGED", "The held source assignment changed before hub receipt could be committed.");
        const updated = await repo.updateHubRecovery(recovery.id, {
          status: "CONFIRMED",
          hubIntakeRecordId: intake.id,
          receivedByUserId: userId,
          receivedAt: clock(),
        }, tx);
        await repo.createAudit({
          actorUserId: userId,
          entityType: "DRIVER_ASSIGNMENT_HUB_RECOVERY",
          entityId: recovery.id,
          action: "DRIVER_ASSIGNMENT_HUB_RECOVERY_RECEIVED",
          reason: recovery.reason,
          before: { status: recovery.status, assignmentStatus: assignment.status, executionHoldAt: assignment.executionHoldAt },
          after: { status: updated.status, hubIntakeRecordId: intake.id, receivedByUserId: userId, assignmentStatus: "FAILED", payoutReviewRequired: true },
          metadata: { weightGrams, lengthMm: lengthMm ?? null, widthMm: widthMm ?? null, heightMm: heightMm ?? null, conditionAtReceipt },
        }, tx);
        await repo.createAudit({
          actorUserId: userId,
          entityType: "DRIVER_ASSIGNMENT",
          entityId: assignment.id,
          action: "DRIVER_ASSIGNMENT_RETIRED_AFTER_HUB_CUSTODY_RECOVERY",
          reason: recovery.reason,
          before: { status: assignment.status, executionHoldAt: assignment.executionHoldAt },
          after: { status: "FAILED", failureReason: "HUB_CUSTODY_RECOVERY_RECEIVED", executionHoldAt: null, executionHoldOperationalCaseId: recovery.operationalCaseId },
        }, tx);
        return { recovery: updated, intake, assignmentStatus: "FAILED", replay: false };
      });
    },

    async setAdminHubIntakeDisposition({
      intakeRecordId, decision, reason, destinationServiceZoneId, destinationHubPointId, actorUserId,
    }) {
      return serializableTransaction(prismaClient, async tx => {
        await requireActiveUser(tx, actorUserId);
        const initialIntake = await repo.findHubIntakeDispositionContext(intakeRecordId, tx);
        if (!initialIntake) return { notFound: true };
        await repo.lockDeliveryLeg(initialIntake.deliveryLegId, tx);
        await repo.lockHubIntake(intakeRecordId, tx);
        await repo.lockHubCapacity(initialIntake.hubPointId, tx);
        const intake = await repo.findHubIntakeDispositionContext(intakeRecordId, tx);
        if (!intake) return { notFound: true };
        if (intake.deliveryLegId !== initialIntake.deliveryLegId
          || intake.hubPointId !== initialIntake.hubPointId) {
          return { blocker: "HUB_INTAKE_STATE_CHANGED" };
        }
        if (intake.status !== "RECEIVED") return { blocker: "HUB_INTAKE_NOT_ACTIVE" };
        if (!intake.driverAssignmentHubRecovery
          || intake.driverAssignmentHubRecovery.status !== "CONFIRMED") {
          return { blocker: "HUB_RECOVERY_INTAKE_REQUIRED" };
        }
        if (intake.parcelBooking.paymentStatus !== "SUCCEEDED"
          || intake.parcelBooking.status !== "IN_TRANSIT") {
          return { blocker: "BOOKING_NOT_IN_TRANSIT" };
        }
        if (intake.hubPoint.status !== "ACTIVE") return { blocker: "HUB_NOT_ACTIVE" };
        if (await repo.findPendingHandover(intake.deliveryLegId, tx)) {
          return { blocker: "PENDING_CUSTODY_HANDOVER_EXISTS" };
        }
        const activeIntake = await repo.findAnyReceivedHubIntake(intake.parcelBookingId, tx);
        if (activeIntake?.id !== intake.id) return { blocker: "PARCEL_CUSTODY_LOCATION_CONFLICT" };

        const existing = intake.disposition;
        if (existing?.status === "RELEASED") return { blocker: "HUB_INTAKE_ALREADY_RELEASED" };
        if (decision === "HOLD_FOR_INVESTIGATION") {
          if (existing?.status === "ROUTE_APPROVED") return { blocker: "HUB_DISPOSITION_ALREADY_APPROVED" };
          const disposition = existing
            ? await repo.updateHubIntakeDisposition(existing.id, {
              decision, status: "HELD", reason, destinationServiceZoneId: null,
              destinationHubPointId: null, nextDeliveryLegId: null, approvedAt: null,
            }, tx)
            : await repo.createHubIntakeDisposition({
              intakeRecordId, hubRecoveryId: intake.driverAssignmentHubRecovery.id,
              parcelBookingId: intake.parcelBookingId, sourceDeliveryLegId: intake.deliveryLegId,
              hubPointId: intake.hubPointId, decision, status: "HELD", reason, createdByUserId: actorUserId,
            }, tx);
          await repo.createAudit({
            actorUserId, entityType: "HUB_INTAKE_DISPOSITION", entityId: disposition.id,
            action: "HUB_RECOVERED_PARCEL_HELD_FOR_INVESTIGATION", reason,
            before: existing ? { decision: existing.decision, status: existing.status } : null,
            after: { decision, status: disposition.status, intakeRecordId, hubRecoveryId: intake.driverAssignmentHubRecovery.id },
          }, tx);
          return { disposition, replay: false };
        }

        if (!destinationServiceZoneId) return { blocker: "CONTINUATION_DESTINATION_REQUIRED" };
        if (existing?.status === "ROUTE_APPROVED") {
          if (existing.destinationServiceZoneId === destinationServiceZoneId
            && (existing.destinationHubPointId ?? null) === (destinationHubPointId ?? null)) {
            const approvedDisposition = await repo.findHubIntakeDisposition(intakeRecordId, tx);
            return { disposition: approvedDisposition, nextDeliveryLeg: approvedDisposition?.nextDeliveryLeg ?? null, replay: true };
          }
          return { blocker: "HUB_DISPOSITION_ALREADY_APPROVED" };
        }

        const sourceLeg = intake.deliveryLeg;
        const latestLeg = await repo.findLatestDeliveryLeg(intake.parcelBookingId, tx);
        if (latestLeg && latestLeg.sequence > sourceLeg.sequence) {
          return { blocker: "EXISTING_FUTURE_LEGS_REQUIRE_REPLAN" };
        }
        const blockingCase = await repo.findBlockingHubOperationalCase(sourceLeg.id, tx);
        if (blockingCase) return { blocker: "OPERATIONAL_CASE_REQUIRES_REVIEW" };
        const originZone = await repo.findServiceZoneForContinuation(intake.hubPoint.serviceZoneId, tx);
        const destinationZone = await repo.findServiceZoneForContinuation(destinationServiceZoneId, tx);
        const zoneIsActive = zone => Boolean(zone?.isActive && zone.state?.isActive && zone.state?.country?.isActive);
        if (!zoneIsActive(originZone) || !zoneIsActive(destinationZone)) {
          return { blocker: "CONTINUATION_SERVICE_ZONE_UNAVAILABLE" };
        }

        let nextLegType;
        let destinationHub = null;
        let destinationLatitude = intake.parcelBooking.destinationLatitude;
        let destinationLongitude = intake.parcelBooking.destinationLongitude;
        if (destinationHubPointId) {
          destinationHub = await repo.findHubForContinuation(destinationHubPointId, tx);
          if (!destinationHub || destinationHub.status !== "ACTIVE"
            || destinationHub.serviceZoneId !== destinationServiceZoneId
            || destinationHub.id === intake.hubPointId) {
            return { blocker: "CONTINUATION_DESTINATION_HUB_INVALID" };
          }
          const acceptedTypes = Array.isArray(destinationHub.acceptedParcelTypes) ? destinationHub.acceptedParcelTypes : [];
          if (acceptedTypes.length && !acceptedTypes.includes(intake.parcelBooking.parcelCategory)) {
            return { blocker: "CONTINUATION_DESTINATION_HUB_REJECTS_PARCEL" };
          }
          nextLegType = originZone.state.id === destinationZone.state.id ? "HUB_TRANSFER" : "INTERSTATE_TRANSPORT";
          destinationLatitude = destinationHub.latitude;
          destinationLongitude = destinationHub.longitude;
        } else {
          if (originZone.state.id !== destinationZone.state.id) {
            return { blocker: "CONTINUATION_DESTINATION_HUB_REQUIRED" };
          }
          if (destinationServiceZoneId !== intake.parcelBooking.destinationServiceZoneId) {
            return { blocker: "CONTINUATION_DESTINATION_HUB_REQUIRED" };
          }
          nextLegType = "FINAL_MILE";
        }

        const sourceLegChanged = await repo.failRecoveredSourceLeg(sourceLeg.id, tx);
        if (sourceLegChanged.count !== 1) return { blocker: "SOURCE_DELIVERY_LEG_STATE_CHANGED" };
        const sequence = (latestLeg?.sequence ?? sourceLeg.sequence) + 1;
        const nextDeliveryLeg = await repo.createContinuationLeg({
          parcelBookingId: intake.parcelBookingId,
          sequence,
          type: nextLegType,
          status: "PLANNED",
          originServiceZoneId: intake.hubPoint.serviceZoneId,
          destinationServiceZoneId,
          originHubPointId: intake.hubPointId,
          destinationHubPointId: destinationHub?.id ?? null,
          originLatitude: intake.hubPoint.latitude,
          originLongitude: intake.hubPoint.longitude,
          destinationLatitude,
          destinationLongitude,
          metadata: {
            source: "DRV-05C-D2_HUB_RECOVERY",
            sourceIntakeRecordId: intakeRecordId,
            sourceDeliveryLegId: sourceLeg.id,
            hubRecoveryId: intake.driverAssignmentHubRecovery.id,
          },
        }, tx);
        const dispositionData = {
          decision: "CONTINUE_DELIVERY",
          status: "ROUTE_APPROVED",
          reason,
          destinationServiceZoneId,
          destinationHubPointId: destinationHub?.id ?? null,
          nextDeliveryLegId: nextDeliveryLeg.id,
          approvedAt: clock(),
          approvedByUserId: actorUserId,
        };
        const disposition = existing
          ? await repo.updateHubIntakeDisposition(existing.id, dispositionData, tx)
          : await repo.createHubIntakeDisposition({
            intakeRecordId, hubRecoveryId: intake.driverAssignmentHubRecovery.id,
            parcelBookingId: intake.parcelBookingId, sourceDeliveryLegId: sourceLeg.id,
            hubPointId: intake.hubPointId, createdByUserId: actorUserId,
            ...dispositionData,
          }, tx);
        await repo.createAudit({
          actorUserId, entityType: "HUB_INTAKE_DISPOSITION", entityId: disposition.id,
          action: "HUB_RECOVERED_PARCEL_ROUTE_APPROVED", reason,
          before: existing ? { decision: existing.decision, status: existing.status } : null,
          after: {
            decision: disposition.decision, status: disposition.status,
            sourceDeliveryLegId: sourceLeg.id, nextDeliveryLegId: nextDeliveryLeg.id,
            nextLegType, originHubPointId: intake.hubPointId,
            destinationServiceZoneId, destinationHubPointId: destinationHub?.id ?? null,
          },
        }, tx);
        return { disposition, nextDeliveryLeg, replay: false };
      });
    },

    async cancelAdminHubRecovery({ recoveryId, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        await requireActiveUser(tx, actorUserId);
        await repo.lockHubRecovery(recoveryId, tx);
        const recovery = await repo.findHubRecovery(recoveryId, tx);
        if (!recovery) return { notFound: true };
        if (recovery.status === "CANCELLED") return { recovery, replay: true };
        if (recovery.status !== "PENDING_RECEIPT" || recovery.hubIntakeRecordId) {
          return { blocker: "HUB_RECOVERY_ALREADY_RECEIVED" };
        }
        const updated = await repo.updateHubRecovery(recovery.id, {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: clock(),
          cancellationReason: reason,
        }, tx);
        await repo.createAudit({
          actorUserId,
          entityType: "DRIVER_ASSIGNMENT_HUB_RECOVERY",
          entityId: recovery.id,
          action: "DRIVER_ASSIGNMENT_HUB_RECOVERY_CANCELLED",
          reason,
          before: { status: recovery.status },
          after: { status: updated.status, cancelledByUserId: actorUserId, cancellationReason: reason },
        }, tx);
        return { recovery: updated, replay: false };
      });
    },

    async listAdminHubRecoveries({ status, hubPointId, cursor, limit = 25 } = {}) {
      const rows = await repo.listAdminHubRecoveries({ status, hubPointId, cursor, limit });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return { items, nextCursor: hasMore ? items.at(-1).id : null };
    },

    async listAdminCustodyHandovers({ status, hubPointId, q, cursor, limit = 25 }) {
      const rows = await repo.listAdminCustodyHandovers({ status, hubPointId, q, cursor, limit });
      const hasMore = rows.length > limit;
      return { items: hasMore ? rows.slice(0, limit) : rows, nextCursor: hasMore ? rows[limit - 1].id : null };
    },

    async listAdminHubIntakes({ status, hubPointId, q, cursor, limit = 25 }) {
      const rows = await repo.listAdminHubIntakes({ status, hubPointId, q, cursor, limit });
      const hasMore = rows.length > limit;
      return { items: hasMore ? rows.slice(0, limit) : rows, nextCursor: hasMore ? rows[limit - 1].id : null };
    },

    async listHubIntakes({ userId, status = "RECEIVED", hubPointId, cursor, limit = 25 }) {
      const memberships = await repo.findHubOperatorsForUser(userId);
      const hubIds = memberships.map(item => item.hubPointId);
      if (!hubIds.length) throw forbidden();
      if (hubPointId && !hubIds.includes(hubPointId)) throw forbidden();
      const rows = await repo.listHubIntakes(hubPointId ? [hubPointId] : hubIds, { status, cursor, limit });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return { items, nextCursor: hasMore ? items.at(-1).id : null };
    },

    async listHubHandovers({ userId, direction = "incoming", status, hubPointId, cursor, limit = 25 }) {
      const memberships = await repo.findHubOperatorsForUser(userId);
      const hubIds = memberships.map(item => item.hubPointId);
      if (!hubIds.length) throw forbidden();
      if (hubPointId && !hubIds.includes(hubPointId)) throw forbidden();
      const scopedHubIds = hubPointId ? [hubPointId] : hubIds;
      const rows = await repo.listHubHandovers(scopedHubIds, { direction, status, cursor, limit });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return { items, nextCursor: hasMore ? items.at(-1).id : null };
    },

    async listHubDispatchable({ userId, hubPointId, cursor, limit = 25 }) {
      const memberships = await repo.findHubOperatorsForUser(userId);
      const dispatchHubIds = memberships.filter(item => item.canDispatch).map(item => item.hubPointId);
      if (!dispatchHubIds.length) throw forbidden();
      if (hubPointId && !dispatchHubIds.includes(hubPointId)) throw forbidden();
      const scopedHubIds = hubPointId ? [hubPointId] : dispatchHubIds;
      const rows = await repo.findDispatchableLegs(scopedHubIds, { cursor, limit });
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(leg => ({
        id: leg.id,
        parcelBookingId: leg.parcelBookingId,
        sequence: leg.sequence,
        type: leg.type,
        status: leg.status,
        parcelBooking: leg.parcelBooking,
        originServiceZone: leg.originServiceZone,
        destinationServiceZone: leg.destinationServiceZone,
        originHubPoint: leg.originHubPoint,
        destinationHubPoint: leg.destinationHubPoint,
        eligibleRecipients: [
          ...leg.assignments.map(assignment => ({
            partyType: "DRIVER", partyId: assignment.driverProfileId,
            displayName: assignment.driverProfile.user.fullName, assignmentId: assignment.id,
          })),
          ...leg.partnerAssignments.map(assignment => ({
            partyType: "TRANSPORT_PARTNER", partyId: assignment.partnerId,
            displayName: assignment.partner.displayName, assignmentId: assignment.id,
          })),
        ],
      }));
      return { items, nextCursor: hasMore ? items.at(-1).id : null };
    },

    async createDriverHubHandover({ assignmentId, conditionAtRelease, evidence }, userId) {
      const assignment = await repo.findDriverAssignmentForCustody(assignmentId);
      if (!assignment) return { notFound: true };
      if (assignment.driverProfile.userId !== userId) throw forbidden();
      if (assignment.status !== "ARRIVED_AT_DESTINATION") return { blocker: "DRIVER_NOT_ARRIVED_AT_HUB" };
      const hubPointId = assignment.deliveryLeg?.destinationHubPointId;
      if (!hubPointId) return { blocker: "DELIVERY_LEG_HAS_NO_DESTINATION_HUB" };
      return this.createHandover({
        parcelBookingId: assignment.parcelBookingId,
        deliveryLegId: assignment.deliveryLegId,
        hubPointId,
        fromPartyType: "DRIVER",
        fromPartyId: assignment.driverProfileId,
        toPartyType: "HUB",
        toPartyId: hubPointId,
        conditionAtRelease,
        evidence,
      }, userId);
    },

    async createHubHandover({ hubPointId, deliveryLegId, toPartyType, toPartyId, conditionAtRelease, evidence }, userId) {
      const membership = await repo.findHubOperator(hubPointId, userId);
      if (!membership?.isActive) throw forbidden();
      const leg = await repo.findBookingLeg(deliveryLegId);
      if (!leg) return { notFound: true };
      if (leg.originHubPointId !== hubPointId) return { blocker: "HUB_NOT_LEG_ORIGIN" };
      const intake = await repo.findReceivedHubIntake(leg.parcelBookingId, hubPointId);
      if (!intake) return { blocker: "HUB_INTAKE_REQUIRED" };
      const recovery = await repo.findHubRecoveryForIntake(intake.id);
      if (recovery) {
        const disposition = await repo.findHubIntakeDisposition(intake.id);
        if (disposition?.status !== "ROUTE_APPROVED" || disposition.nextDeliveryLegId !== leg.id) {
          return { blocker: "HUB_RECOVERY_DISPOSITION_REQUIRED" };
        }
      }
      if (toPartyType === "DRIVER") {
        const assignment = leg.assignments.find(item => item.driverProfileId === toPartyId && item.status === "ARRIVED_AT_PICKUP");
        if (!assignment) return { blocker: "DRIVER_NOT_ARRIVED_AT_HUB" };
      } else if (toPartyType === "TRANSPORT_PARTNER") {
        const assignment = leg.partnerAssignments.find(item => item.partnerId === toPartyId && item.status === "ACCEPTED");
        if (!assignment) return { blocker: "PARTNER_NOT_READY_FOR_HANDOVER" };
      } else {
        return { blocker: "INVALID_HANDOVER_RECIPIENT" };
      }
      return this.createHandover({
        parcelBookingId: leg.parcelBookingId,
        deliveryLegId: leg.id,
        hubPointId,
        fromPartyType: "HUB",
        fromPartyId: hubPointId,
        toPartyType,
        toPartyId,
        conditionAtRelease,
        evidence,
      }, userId);
    },

    async reportHubException({ hubPointId, deliveryLegId, type, priority = "NORMAL", title, description, evidence }, userId) {
      return repo.transaction(async tx => {
        await requireActiveUser(tx, userId);
        const membership = await repo.findHubOperator(hubPointId, userId, tx);
        if (!membership?.isActive) throw forbidden();
        const hub = await repo.findHubForParty(hubPointId, tx);
        if (!hub || hub.status !== "ACTIVE") return { notFound: true };
        await repo.lockDeliveryLeg(deliveryLegId, tx);
        const leg = await repo.findBookingLeg(deliveryLegId, tx);
        if (!leg || ![leg.originHubPointId, leg.destinationHubPointId].includes(hubPointId)) return { notFound: true };
        if (leg.parcelBooking.paymentStatus !== "SUCCEEDED") return { blocker: "BOOKING_NOT_PAID" };
        const existingCase = await repo.findActiveHubOperationalCase({ deliveryLegId: leg.id, hubPointId, type }, tx);
        if (existingCase) return { operationalCase: existingCase, replay: true };
        const operationalCase = await repo.createOperationalCase({
          publicReference: "CASE-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
          type, status: "OPEN", priority,
          parcelBookingId: leg.parcelBookingId, deliveryLegId: leg.id, hubPointId,
          reportedByUserId: userId, title, description, evidence: evidence ?? undefined,
        }, tx);
        await repo.createAudit({
          actorUserId: userId, entityType: "OPERATIONAL_CASE", entityId: operationalCase.id,
          action: "HUB_OPERATIONAL_EXCEPTION_REPORTED",
          after: { hubPointId, deliveryLegId, type, priority, publicReference: operationalCase.publicReference },
        }, tx);
        return { operationalCase };
      });
    },

    async listMyHandovers(userId) {
      const [hubs, partners, drivers] = await Promise.all([
        repo.findHubOperatorsForUser(userId),
        prismaClient.transportPartnerMember.findMany({ where: { userId, isActive: true }, select: { partnerId: true } }),
        prismaClient.driverProfile.findMany({ where: { userId }, select: { id: true } }),
      ]);
      return repo.listMyHandovers(userId, hubs.map(x => x.hubPointId), partners.map(x => x.partnerId), drivers.map(x => x.id));
    },
  };
}

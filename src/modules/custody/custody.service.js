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

    async addHubOperator({ hubPointId, userId, role = "OPERATOR", actorUserId }) {
      return repo.transaction(async tx => {
        const hub = await repo.findHub(hubPointId, tx);
        if (!hub) return { notFound: true };
        const user = await repo.findUser(userId, tx);
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        if (!["CUSTOMER", "HUB_OPERATOR", "PARTNER_OPERATOR"].includes(user.role)) return { blocker: "USER_ROLE_CONFLICT" };
        const operator = await repo.upsertHubOperator({ hubPointId, userId, role, isActive: true }, tx);
        if (user.role === "CUSTOMER") await repo.setUserRole(userId, "HUB_OPERATOR", tx);
        await repo.createAudit({
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: operator.id,
          action: "HUB_OPERATOR_ACTIVATED",
          before: { userRole: user.role },
          after: { hubPointId, userId, role, isActive: true, userRole: user.role === "CUSTOMER" ? "HUB_OPERATOR" : user.role },
        }, tx);
        return { operator };
      });
    },

    async setHubOperatorStatus({ hubPointId, operatorId, isActive, actorUserId }) {
      return repo.transaction(async tx => {
        const current = await repo.findHubOperatorById(hubPointId, operatorId, tx);
        if (!current) return { notFound: true };
        const operator = await repo.updateHubOperator(operatorId, isActive, tx);
        const activeCount = await repo.countActiveHubMemberships(current.userId, tx);
        const partnerCount = await tx.transportPartnerMember.count({ where: { userId: current.userId, isActive: true } });
        if (!activeCount && !partnerCount) await tx.user.updateMany({ where: { id: current.userId, role: { in: ["HUB_OPERATOR", "PARTNER_OPERATOR"] } }, data: { role: "CUSTOMER" } });
        await repo.createAudit({
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: operatorId,
          action: isActive ? "HUB_OPERATOR_ACTIVATED" : "HUB_OPERATOR_SUSPENDED",
          before: { isActive: current.isActive }, after: { isActive },
        }, tx);
        return { operator };
      });
    },

    async createHandover(input, userId) {
      return repo.transaction(async tx => {
        await requireActiveUser(tx, userId);
        const leg = await repo.findBookingLeg(input.deliveryLegId, tx);
        if (!leg || leg.parcelBookingId !== input.parcelBookingId) return { notFound: true };
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
        await validateParty(tx, { type: input.fromPartyType, id: input.fromPartyId, userId, booking: leg.parcelBooking, leg, actor: true });
        await validateParty(tx, { type: input.toPartyType, id: input.toPartyId, userId, booking: leg.parcelBooking, leg });
        if (input.fromPartyType === input.toPartyType && input.fromPartyId === input.toPartyId) {
          return { blocker: "SAME_CUSTODY_PARTY" };
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

    async confirmHandover({ handoverId, userId, conditionAtReceipt, evidence, rejectReason }) {
      return repo.transaction(async tx => {
        await requireActiveUser(tx, userId);
        const handover = await repo.findHandover(handoverId, tx);
        if (!handover) return { notFound: true };
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
        const updated = await repo.updateHandover(handoverId, {
          status: "CONFIRMED", confirmedByUserId: userId, confirmedAt: clock(),
          conditionAtReceipt: conditionAtReceipt ?? handover.conditionAtRelease,
          evidence: evidence ?? handover.evidence ?? undefined,
        }, tx);

        const confirmedLeg = await repo.findBookingLeg(handover.deliveryLegId, tx);

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
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: handover.parcelBookingId,
              actorUserId: userId,
              eventType: "HUB_PICKUP_CUSTODY_CONFIRMED",
              fromStatus: "ARRIVED_AT_PICKUP",
              toStatus: "PICKUP_CONFIRMED",
              metadata: { assignmentId: assignment.id, deliveryLegId: handover.deliveryLegId, handoverId },
            },
          });
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
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: handover.parcelBookingId,
              actorUserId: userId,
              eventType: "HUB_DESTINATION_CUSTODY_CONFIRMED",
              fromStatus: "DELIVERY_VERIFICATION_PENDING",
              toStatus: "COMPLETED",
              metadata: { assignmentId: assignment.id, deliveryLegId: handover.deliveryLegId, nextDeliveryLegId: nextLeg?.id ?? null, handoverId },
            },
          });
        }

        // A partner interstate leg is complete only when its destination hub confirms custody.
        if (handover.fromPartyType === "TRANSPORT_PARTNER" && handover.toPartyType === "HUB"
          && confirmedLeg?.destinationHubPointId === handover.toPartyId) {
          const assignment = await tx.partnerDeliveryAssignment.findFirst({
            where: { deliveryLegId: handover.deliveryLegId, partnerId: handover.fromPartyId, status: "IN_TRANSIT" },
          });
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
              await tx.parcelBooking.update({
                where: { id: handover.parcelBookingId },
                data: { status: "IN_TRANSIT" },
              });
              await tx.bookingEvent.create({
                data: {
                  parcelBookingId: handover.parcelBookingId,
                  actorUserId: userId,
                  eventType: "PARTNER_HUB_CUSTODY_CONFIRMED",
                  fromStatus: "IN_TRANSIT",
                  toStatus: "COMPLETED",
                  metadata: { partnerAssignmentId: assignment.id, deliveryLegId: handover.deliveryLegId, nextDeliveryLegId: nextLeg?.id ?? null, handoverId },
                },
              });
              await repo.createAudit({
                actorUserId: userId, entityType: "PARTNER_DELIVERY_ASSIGNMENT",
                entityId: assignment.id, action: "PARTNER_EXECUTION_COMPLETED_AND_PAYABLE_CREATED",
                before: { status: assignment.status },
                after: { status: "COMPLETED", payableId: payable.id, amountMinor: payable.amountMinor.toString(), currency: payable.currency },
              }, tx);
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
      const hubIds = memberships.map(item => item.hubPointId);
      if (!hubIds.length) throw forbidden();
      if (hubPointId && !hubIds.includes(hubPointId)) throw forbidden();
      const scopedHubIds = hubPointId ? [hubPointId] : hubIds;
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
      const leg = await repo.findBookingLeg(deliveryLegId);
      if (!leg) return { notFound: true };
      if (leg.originHubPointId !== hubPointId) return { blocker: "HUB_NOT_LEG_ORIGIN" };
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
        const leg = await repo.findBookingLeg(deliveryLegId, tx);
        if (!leg || ![leg.originHubPointId, leg.destinationHubPointId].includes(hubPointId)) return { notFound: true };
        if (leg.parcelBooking.paymentStatus !== "SUCCEEDED") return { blocker: "BOOKING_NOT_PAID" };
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

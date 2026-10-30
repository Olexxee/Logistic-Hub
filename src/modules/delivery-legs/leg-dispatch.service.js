import { createHash } from "node:crypto";
import { isDriverWithinPickupRadius } from "../dispatch/dispatch.service.js";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP",
  "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION",
];
const OFFER_TTL_MS = 10 * 60 * 1000;

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function conflict(code, message) { throw httpError(409, code, message); }
function forbidden(message = "You do not have permission to perform this action.") {
  throw httpError(403, "FORBIDDEN", message);
}
function notFound(message = "Delivery leg or offer was not found.") {
  throw httpError(404, "NOT_FOUND", message);
}
function isLocalDriverLeg(leg) {
  return leg?.type === "LOCAL_PICKUP" || leg?.type === "FINAL_MILE" || leg?.type === "DIRECT";
}
export function isDriverAssignableDeliveryLeg(leg) {
  return Boolean(leg && leg.status === "READY_FOR_ASSIGNMENT" && isLocalDriverLeg(leg));
}
function serializeProposal(offer) {
  return {
    id: offer.id,
    status: offer.status,
    proposedFareMinor: offer.proposedFareMinor?.toString() ?? null,
    currency: offer.currency,
    expiresAt: offer.expiresAt,
    driver: offer.driverProfile ? {
      displayName: offer.driverProfile.user?.fullName ?? "Logistic Hub driver",
      rating: offer.driverProfile.averageRating?.toString() ?? null,
      completedJobs: offer.driverProfile.completedJobs,
    } : undefined,
  };
}

export function createLegDispatchService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function findVisibleLeg(tx, legId) {
    return tx.deliveryLeg.findUnique({
      where: { id: legId },
      include: {
        parcelBooking: true,
        originServiceZone: { select: { id: true, name: true, stateId: true, isActive: true } },
        destinationServiceZone: { select: { id: true, name: true, stateId: true, isActive: true } },
        originHubPoint: { select: { id: true, name: true } },
        destinationHubPoint: { select: { id: true, name: true } },
      },
    });
  }

  return {
    async requestMatching({ legId, user }) {
      const now = clock();
      return prismaClient.$transaction(async (tx) => {
        const leg = await findVisibleLeg(tx, legId);
        if (!leg) return null;
        if (leg.parcelBooking.senderId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) forbidden();
        if (!isDriverAssignableDeliveryLeg(leg)) {
          conflict("DELIVERY_LEG_NOT_DRIVER_DISPATCHABLE", "Only a ready local pickup or final-mile leg can be assigned to a local driver. Interstate transport legs require partner execution.");
        }
        if (leg.parcelBooking.status !== "AWAITING_PAYMENT") {
          conflict("BOOKING_NOT_READY_FOR_LEG_DISPATCH", "The partner quote must be accepted before local leg dispatch can begin.");
        }
        const existing = await tx.driverOffer.count({
          where: { deliveryLegId: leg.id, status: "OFFERED", expiresAt: { gt: now } },
        });
        if (existing > 0) return { deliveryLegId: leg.id, status: leg.status, offersCreated: existing, replay: true };

        const zones = await tx.serviceZone.findMany({
          where: {
            id: { in: [...new Set([leg.originServiceZoneId, leg.destinationServiceZoneId])] },
            isActive: true,
            state: { isActive: true, country: { isActive: true } },
            availability: {
              some: {
                serviceType: "PARCEL_DELIVERY",
                isEnabled: true,
                AND: [
                  { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                  { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                ],
              },
            },
          },
          select: { id: true, stateId: true },
        });
        const expectedZoneCount = new Set([leg.originServiceZoneId, leg.destinationServiceZoneId]).size;
        if (zones.length !== expectedZoneCount || new Set(zones.map((zone) => zone.stateId)).size !== 1) {
          conflict("LOCAL_LEG_ZONE_UNAVAILABLE", "Both ends of a local driver leg must be active parcel-delivery zones in the same state.");
        }

        const drivers = await tx.driverProfile.findMany({
          where: {
            verificationStatus: "VERIFIED",
            isOnline: true,
            isAvailable: true,
            lastLocationAt: { gte: new Date(now.getTime() - 5 * 60_000), lte: now },
            user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
            vehicles: { some: { isActive: true, verificationStatus: "VERIFIED" } },
            coverage: {
              some: { serviceZoneId: leg.originServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true },
            },
            assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
          },
          include: {
            locations: { take: 1, orderBy: { recordedAt: "desc" } },
            coverage: { select: { serviceZoneId: true, serviceType: true, isEnabled: true } },
          },
        });
        const pickup = {
          latitude: leg.originLatitude ?? leg.parcelBooking.pickupLatitude,
          longitude: leg.originLongitude ?? leg.parcelBooking.pickupLongitude,
        };
        const eligible = drivers.filter((driver) =>
          driver.coverage?.some((coverage) =>
            coverage.serviceZoneId === leg.destinationServiceZoneId
            && coverage.serviceType === "PARCEL_DELIVERY"
            && coverage.isEnabled,
          ) && isDriverWithinPickupRadius(driver, pickup, now),
        );
        if (eligible.length === 0) {
          return { deliveryLegId: leg.id, status: leg.status, offersCreated: 0, offersExpireAt: null };
        }
        const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
        const created = await tx.driverOffer.createMany({
          data: eligible.map((driver) => ({
            deliveryLegId: leg.id,
            driverProfileId: driver.id,
            currency: leg.parcelBooking.currency,
            expiresAt,
          })),
          skipDuplicates: true,
        });
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: leg.parcelBookingId,
            actorUserId: user.id,
            eventType: "DELIVERY_LEG_MATCHING_REQUESTED",
            fromStatus: leg.status,
            toStatus: leg.status,
            metadata: { deliveryLegId: leg.id, offersCreated: created.count, eligibleDrivers: eligible.length, expiresAt: expiresAt.toISOString() },
          },
        });
        return { deliveryLegId: leg.id, status: leg.status, offersCreated: created.count, offersExpireAt: expiresAt, replay: false };
      });
    },

    async listCustomerOffers({ legId, user }) {
      const leg = await prismaClient.deliveryLeg.findUnique({
        where: { id: legId },
        select: { id: true, parcelBooking: { select: { senderId: true } } },
      });
      if (!leg) return null;
      if (leg.parcelBooking.senderId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) forbidden();
      const offers = await prismaClient.driverOffer.findMany({
        where: { deliveryLegId: leg.id, status: { in: ["OFFERED", "ACCEPTED"] }, proposedFareMinor: { not: null } },
        include: { driverProfile: { select: { averageRating: true, completedJobs: true, user: { select: { fullName: true } } } } },
        orderBy: [{ proposedFareMinor: "asc" }, { createdAt: "asc" }],
      });
      return offers.map(serializeProposal);
    },

    async listDriverOffers({ userId }) {
      const now = clock();
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
        forbidden("A verified, online and available driver profile is required.");
      }
      const offers = await prismaClient.driverOffer.findMany({
        where: {
          driverProfileId: profile.id,
          deliveryLegId: { not: null },
          status: "OFFERED",
          proposedFareMinor: null,
          expiresAt: { gt: now },
          deliveryLeg: {
            is: {
              status: "READY_FOR_ASSIGNMENT",
              type: { in: ["LOCAL_PICKUP", "FINAL_MILE", "DIRECT"] },
              parcelBooking: { is: { status: "AWAITING_PAYMENT" } },
            },
          },
        },
        include: {
          deliveryLeg: {
            include: {
              parcelBooking: { select: { publicReference: true, currency: true, parcelCategory: true, parcelSize: true } },
              originServiceZone: { select: { name: true } },
              destinationServiceZone: { select: { name: true } },
              originHubPoint: { select: { name: true } },
              destinationHubPoint: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return offers.map((offer) => ({
        id: offer.id,
        currency: offer.currency,
        expiresAt: offer.expiresAt,
        createdAt: offer.createdAt,
        deliveryLeg: {
          id: offer.deliveryLeg.id,
          sequence: offer.deliveryLeg.sequence,
          type: offer.deliveryLeg.type,
          bookingReference: offer.deliveryLeg.parcelBooking.publicReference,
          parcelCategory: offer.deliveryLeg.parcelBooking.parcelCategory,
          parcelSize: offer.deliveryLeg.parcelBooking.parcelSize,
          originZone: offer.deliveryLeg.originServiceZone.name,
          destinationZone: offer.deliveryLeg.destinationServiceZone.name,
          originHub: offer.deliveryLeg.originHubPoint?.name ?? null,
          destinationHub: offer.deliveryLeg.destinationHubPoint?.name ?? null,
        },
      }));
    },

    async proposeFare({ offerId, userId, proposedFareMinor, idempotencyKey }) {
      const now = clock();
      const fare = BigInt(proposedFareMinor);
      const proposalHash = hash({ offerId, proposedFareMinor });
      try {
        return await prismaClient.$transaction(async (tx) => {
          const profile = await tx.driverProfile.findUnique({
            where: { userId },
            select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
          });
          if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
            forbidden("A verified, online and available driver profile is required.");
          }
          const offer = await tx.driverOffer.findUnique({
            where: { id: offerId },
            include: { deliveryLeg: { include: { parcelBooking: true } } },
          });
          if (!offer || offer.driverProfileId !== profile.id || !offer.deliveryLeg) notFound("Driver delivery-leg offer was not found.");
          if (offer.fareProposalIdempotencyKey === idempotencyKey) {
            if (offer.fareProposalPayloadHash !== proposalHash) conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
            return { offerId: offer.id, proposedFareMinor: offer.proposedFareMinor.toString(), currency: offer.currency, status: offer.status, replay: true };
          }
          const leg = offer.deliveryLeg;
          if (offer.proposedFareMinor != null) conflict("OFFER_ALREADY_PROPOSED", "A fare proposal has already been submitted for this offer.");
          if (offer.status !== "OFFERED" || offer.expiresAt <= now || !isDriverAssignableDeliveryLeg(leg)) {
            conflict("OFFER_NO_LONGER_AVAILABLE", "This delivery-leg offer is no longer available.");
          }
          const minimum = BigInt(leg.parcelBooking.pricingSnapshot?.minimumDriverFareMinor ?? "0");
          if (fare < minimum) throw httpError(400, "FARE_BELOW_MINIMUM", "The proposed fare is below the configured minimum for this service.");
          const updated = await tx.driverOffer.updateMany({
            where: { id: offer.id, driverProfileId: profile.id, status: "OFFERED", proposedFareMinor: null, expiresAt: { gt: now } },
            data: { proposedFareMinor: fare, respondedAt: now, fareProposalIdempotencyKey: idempotencyKey, fareProposalPayloadHash: proposalHash },
          });
          if (updated.count !== 1) conflict("OFFER_NO_LONGER_AVAILABLE", "This delivery-leg offer is no longer available.");
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: leg.parcelBookingId,
              actorUserId: userId,
              eventType: "DELIVERY_LEG_DRIVER_FARE_PROPOSED",
              fromStatus: leg.status,
              toStatus: leg.status,
              metadata: { deliveryLegId: leg.id, offerId: offer.id, proposedFareMinor: fare.toString(), currency: offer.currency },
            },
          });
          return { offerId: offer.id, deliveryLegId: leg.id, proposedFareMinor: fare.toString(), currency: offer.currency, status: "OFFERED", replay: false };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await prismaClient.driverOffer.findUnique({ where: { fareProposalIdempotencyKey: idempotencyKey } });
        if (!existing || existing.id !== offerId || existing.fareProposalPayloadHash !== proposalHash) {
          conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
        }
        return { offerId: existing.id, proposedFareMinor: existing.proposedFareMinor.toString(), currency: existing.currency, status: existing.status, replay: true };
      }
    },

    async acceptFare({ legId, user, offerId, idempotencyKey }) {
      const now = clock();
      const acceptanceHash = hash({ legId, offerId });
      try {
        return await prismaClient.$transaction(async (tx) => {
          const leg = await findVisibleLeg(tx, legId);
          if (!leg) return null;
          if (leg.parcelBooking.senderId !== user.id) forbidden();
          if (leg.fareAcceptanceIdempotencyKey === idempotencyKey) {
            if (leg.fareAcceptancePayloadHash !== acceptanceHash) conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different leg fare acceptance.");
            const assignment = await tx.driverAssignment.findFirst({
              where: { deliveryLegId: leg.id },
              orderBy: { createdAt: "desc" },
              select: { id: true, driverProfileId: true, agreedFareMinor: true, paymentExpiresAt: true },
            });
            return {
              deliveryLegId: leg.id,
              status: leg.status,
              assignmentId: assignment?.id ?? null,
              driverFareMinor: leg.driverFareMinor?.toString() ?? null,
              currency: leg.parcelBooking.currency,
              paymentExpiresAt: assignment?.paymentExpiresAt ?? null,
              replay: true,
            };
          }
          if (!isDriverAssignableDeliveryLeg(leg) || leg.parcelBooking.status !== "AWAITING_PAYMENT") {
            conflict("DELIVERY_LEG_STATE_CONFLICT", "The delivery leg or booking is no longer available for fare acceptance.");
          }
          const offer = await tx.driverOffer.findUnique({ where: { id: offerId } });
          if (!offer || offer.deliveryLegId !== leg.id || offer.status !== "OFFERED" || offer.proposedFareMinor == null || offer.expiresAt <= now) {
            conflict("OFFER_NO_LONGER_AVAILABLE", "The selected driver fare proposal is invalid or expired.");
          }
          const fare = offer.proposedFareMinor;
          const minimum = BigInt(leg.parcelBooking.pricingSnapshot?.minimumDriverFareMinor ?? "0");
          if (fare <= 0n || fare < minimum) conflict("INVALID_FARE", "The selected driver fare is invalid or below the configured minimum.");
          const paymentExpiresAt = new Date(now.getTime() + 15 * 60_000);

          const reserved = await tx.driverProfile.updateMany({
            where: {
              id: offer.driverProfileId,
              verificationStatus: "VERIFIED",
              isOnline: true,
              isAvailable: true,
              user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
              vehicles: { some: { isActive: true, verificationStatus: "VERIFIED" } },
              AND: [
                { coverage: { some: { serviceZoneId: leg.originServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true } } },
                { coverage: { some: { serviceZoneId: leg.destinationServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true } } },
              ],
              assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
            },
            data: { isAvailable: false },
          });
          if (reserved.count !== 1) conflict("DRIVER_NO_LONGER_AVAILABLE", "The driver is no longer available. Select another fare proposal.");

          const legClaim = await tx.deliveryLeg.updateMany({
            where: { id: leg.id, status: "READY_FOR_ASSIGNMENT", fareAcceptanceIdempotencyKey: null },
            data: {
              status: "AWAITING_PAYMENT",
              driverFareMinor: fare,
              fareAcceptanceIdempotencyKey: idempotencyKey,
              fareAcceptancePayloadHash: acceptanceHash,
              assignedAt: now,
            },
          });
          if (legClaim.count !== 1) conflict("DELIVERY_LEG_STATE_CONFLICT", "Another request has already accepted a fare for this leg.");

          const accepted = await tx.driverOffer.updateMany({
            where: { id: offer.id, deliveryLegId: leg.id, status: "OFFERED", proposedFareMinor: fare, expiresAt: { gt: now } },
            data: { status: "ACCEPTED", respondedAt: now },
          });
          if (accepted.count !== 1) conflict("OFFER_NO_LONGER_AVAILABLE", "The selected driver fare proposal is no longer available.");
          await tx.driverOffer.updateMany({
            where: { deliveryLegId: leg.id, id: { not: offer.id }, status: "OFFERED" },
            data: { status: "WITHDRAWN", respondedAt: now },
          });

          const assignment = await tx.driverAssignment.create({
            data: {
              parcelBookingId: leg.parcelBookingId,
              deliveryLegId: leg.id,
              driverProfileId: offer.driverProfileId,
              assignedByUserId: user.id,
              status: "AWAITING_PAYMENT",
              agreedFareMinor: fare,
              currency: leg.parcelBooking.currency,
              reservedAt: now,
              paymentExpiresAt,
            },
            select: { id: true },
          });
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: leg.parcelBookingId,
              actorUserId: user.id,
              eventType: "DELIVERY_LEG_DRIVER_FARE_ACCEPTED",
              fromStatus: "READY_FOR_ASSIGNMENT",
              toStatus: "AWAITING_PAYMENT",
              metadata: { deliveryLegId: leg.id, offerId: offer.id, assignmentId: assignment.id, driverFareMinor: fare.toString(), paymentExpiresAt: paymentExpiresAt.toISOString() },
            },
          });
          return {
            deliveryLegId: leg.id,
            status: "AWAITING_PAYMENT",
            assignmentId: assignment.id,
            driverFareMinor: fare.toString(),
            currency: leg.parcelBooking.currency,
            paymentExpiresAt,
            replay: false,
          };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await prismaClient.deliveryLeg.findUnique({ where: { fareAcceptanceIdempotencyKey: idempotencyKey } });
        if (!existing || existing.id !== legId || existing.fareAcceptancePayloadHash !== acceptanceHash) {
          conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different leg fare acceptance.");
        }
        const assignment = await prismaClient.driverAssignment.findFirst({
          where: { deliveryLegId: legId },
          orderBy: { createdAt: "desc" },
          select: { id: true, paymentExpiresAt: true },
        });
        return { deliveryLegId: legId, status: existing.status, assignmentId: assignment?.id ?? null, driverFareMinor: existing.driverFareMinor?.toString() ?? null, paymentExpiresAt: assignment?.paymentExpiresAt ?? null, replay: true };
      }
    },
  };
}

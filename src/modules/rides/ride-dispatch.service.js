import { createHash } from "node:crypto";

const ACTIVE_ASSIGNMENTS = ["AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"];
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function failure(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
const forbidden = () => failure(403, "FORBIDDEN", "You do not have permission to perform this action.");
function serializeOffer(offer) {
  return {
    id: offer.id, status: offer.status,
    proposedFareMinor: offer.proposedFareMinor == null ? null : offer.proposedFareMinor.toString(),
    currency: offer.currency, expiresAt: offer.expiresAt, createdAt: offer.createdAt,
    driver: offer.driverProfile ? {
      displayName: offer.driverProfile.user?.fullName ?? "Logistic Hub driver",
      averageRating: offer.driverProfile.averageRating == null ? null : String(offer.driverProfile.averageRating),
      completedJobs: offer.driverProfile.completedJobs,
    } : undefined,
  };
}

export function createRideDispatchService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async requestMatching({ rideBookingId, user }) {
      const now = clock();
      return prismaClient.$transaction(async (tx) => {
        const ride = await tx.rideBooking.findUnique({ where: { id: rideBookingId } });
        if (!ride) return null;
        if (ride.passengerId !== user.id) throw forbidden();
        if (ride.status !== "DRAFT") throw failure(409, "RIDE_STATE_CONFLICT", "Only a draft ride can request driver offers.");
        const drivers = await tx.driverProfile.findMany({
          where: {
            verificationStatus: "VERIFIED", isOnline: true, isAvailable: true,
            user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
            vehicles: { some: { type: ride.vehicleType, isActive: true, verificationStatus: "VERIFIED" } },
            coverage: { some: { serviceZoneId: ride.pickupServiceZoneId, serviceType: "PASSENGER_RIDE", isEnabled: true } },
            AND: [{ coverage: { some: { serviceZoneId: ride.destinationServiceZoneId, serviceType: "PASSENGER_RIDE", isEnabled: true } } }],
            assignments: { none: { status: { in: ACTIVE_ASSIGNMENTS } } },
          },
          select: { id: true },
        });
        if (!drivers.length) throw failure(409, "NO_ELIGIBLE_DRIVERS", "No verified, available drivers cover this ride.");
        const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
        const result = await tx.driverOffer.createMany({
          data: drivers.map(({ id }) => ({
            rideBookingId: ride.id, driverProfileId: id, status: "OFFERED",
            currency: ride.currency, expiresAt,
          })),
        });
        const changed = await tx.rideBooking.updateMany({
          where: { id: ride.id, passengerId: user.id, status: "DRAFT" },
          data: { status: "MATCHING" },
        });
        if (changed.count !== 1) throw failure(409, "RIDE_STATE_CONFLICT", "The ride changed while matching was being requested.");
        await tx.bookingEvent.create({
          data: {
            rideBookingId: ride.id, actorUserId: user.id, eventType: "RIDE_MATCHING_REQUESTED",
            fromStatus: "DRAFT", toStatus: "MATCHING",
            metadata: { offersCreated: result.count, expiresAt: expiresAt.toISOString() },
          },
        });
        return { rideBookingId: ride.id, status: "MATCHING", offersCreated: result.count, offersExpireAt: expiresAt };
      });
    },

    async listPassengerOffers({ rideBookingId, user }) {
      const ride = await prismaClient.rideBooking.findUnique({ where: { id: rideBookingId }, select: { id: true, passengerId: true } });
      if (!ride) return null;
      if (ride.passengerId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) throw forbidden();
      const offers = await prismaClient.driverOffer.findMany({
        where: { rideBookingId: ride.id, status: { in: ["OFFERED", "ACCEPTED"] }, proposedFareMinor: { not: null } },
        include: { driverProfile: { select: {
          averageRating: true, completedJobs: true, user: { select: { fullName: true } },
        } } },
        orderBy: [{ proposedFareMinor: "asc" }, { createdAt: "asc" }],
      });
      return offers.map(serializeOffer);
    },

    async listDriverOffers({ userId }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId }, select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
        throw forbidden();
      }
      const offers = await prismaClient.driverOffer.findMany({
        where: {
          driverProfileId: profile.id, rideBookingId: { not: null }, status: "OFFERED",
          proposedFareMinor: null, expiresAt: { gt: clock() },
          rideBooking: { is: { status: "MATCHING" } },
        },
        include: { rideBooking: { select: {
          id: true, publicReference: true, pickupAddress: true, destinationAddress: true,
          pickupServiceZoneId: true, destinationServiceZoneId: true, vehicleType: true, currency: true,
        } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return offers.map((offer) => ({ id: offer.id, expiresAt: offer.expiresAt, createdAt: offer.createdAt, ride: offer.rideBooking }));
    },

    async proposeFare({ offerId, userId, proposedFareMinor, idempotencyKey }) {
      const proposed = BigInt(proposedFareMinor);
      const payloadHash = hash({ offerId, proposedFareMinor });
      const now = clock();
      return prismaClient.$transaction(async (tx) => {
        const existing = await tx.driverOffer.findUnique({ where: { fareProposalIdempotencyKey: idempotencyKey } });
        if (existing) {
          if (existing.driverProfileId !== (await tx.driverProfile.findUnique({ where: { userId }, select: { id: true } }))?.id ||
              existing.fareProposalPayloadHash !== payloadHash) {
            throw failure(409, "IDEMPOTENCY_CONFLICT", "The Idempotency-Key was used for a different fare proposal.");
          }
          return { offerId: existing.id, status: existing.status, proposedFareMinor: existing.proposedFareMinor?.toString(), expiresAt: existing.expiresAt, replay: true };
        }
        const profile = await tx.driverProfile.findUnique({ where: { userId }, select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true } });
        if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) throw forbidden();
        const offer = await tx.driverOffer.findUnique({ where: { id: offerId }, include: { rideBooking: true } });
        if (!offer || offer.driverProfileId !== profile.id || !offer.rideBookingId || offer.status !== "OFFERED" ||
            offer.proposedFareMinor != null || offer.expiresAt <= now || offer.rideBooking?.status !== "MATCHING") {
          throw failure(409, "OFFER_NO_LONGER_AVAILABLE", "The ride offer is invalid or expired.");
        }
        const minimum = BigInt(offer.rideBooking.pricingSnapshot?.minimumDriverFareMinor ?? "0");
        if (proposed <= 0n || proposed < minimum) throw failure(409, "INVALID_FARE", "The fare is below the configured minimum.");
        const changed = await tx.driverOffer.updateMany({
          where: { id: offer.id, status: "OFFERED", proposedFareMinor: null, expiresAt: { gt: now } },
          data: { proposedFareMinor: proposed, fareProposalIdempotencyKey: idempotencyKey, fareProposalPayloadHash: payloadHash, respondedAt: now },
        });
        if (changed.count !== 1) throw failure(409, "OFFER_NO_LONGER_AVAILABLE", "The offer was updated concurrently.");
        return { offerId: offer.id, status: "OFFERED", proposedFareMinor: proposed.toString(), currency: offer.currency, expiresAt: offer.expiresAt, replay: false };
      });
    },

    async acceptFare({ rideBookingId, user, offerId, idempotencyKey }) {
      const payloadHash = hash({ rideBookingId, offerId });
      const now = clock();
      return prismaClient.$transaction(async (tx) => {
        const ride = await tx.rideBooking.findUnique({ where: { id: rideBookingId } });
        if (!ride) return null;
        if (ride.passengerId !== user.id) throw forbidden();
        if (ride.fareAcceptanceIdempotencyKey === idempotencyKey) {
          if (ride.fareAcceptancePayloadHash !== payloadHash) throw failure(409, "IDEMPOTENCY_CONFLICT", "The Idempotency-Key was used for a different fare acceptance.");
          const assignment = await tx.driverAssignment.findFirst({ where: { rideBookingId: ride.id, status: "AWAITING_PAYMENT" }, select: { id: true, paymentExpiresAt: true } });
          return {
            rideBookingId: ride.id, status: ride.status, assignmentId: assignment?.id ?? null,
            driverFareMinor: ride.driverFareMinor?.toString() ?? null,
            connectionFeeMinor: ride.connectionFeeMinor.toString(),
            customerPayableMinor: ride.customerPayableMinor?.toString() ?? null,
            currency: ride.currency, paymentExpiresAt: assignment?.paymentExpiresAt ?? null, replay: true,
          };
        }
        if (ride.status !== "MATCHING") throw failure(409, "RIDE_STATE_CONFLICT", "A fare can only be accepted while the ride is matching.");
        const offer = await tx.driverOffer.findUnique({ where: { id: offerId } });
        if (!offer || offer.rideBookingId !== ride.id || offer.status !== "OFFERED" || offer.proposedFareMinor == null || offer.expiresAt <= now) {
          throw failure(409, "OFFER_NO_LONGER_AVAILABLE", "The selected fare proposal is invalid or expired.");
        }
        const fare = offer.proposedFareMinor;
        const minimum = BigInt(ride.pricingSnapshot?.minimumDriverFareMinor ?? "0");
        if (fare <= 0n || fare < minimum) throw failure(409, "INVALID_FARE", "The selected driver fare is below the configured minimum.");
        const payable = fare + ride.connectionFeeMinor;
        const paymentExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);
        const reserved = await tx.driverProfile.updateMany({
          where: {
            id: offer.driverProfileId, verificationStatus: "VERIFIED", isOnline: true, isAvailable: true,
            user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
            vehicles: { some: { type: ride.vehicleType, isActive: true, verificationStatus: "VERIFIED" } },
            AND: [
              { coverage: { some: { serviceZoneId: ride.pickupServiceZoneId, serviceType: "PASSENGER_RIDE", isEnabled: true } } },
              { coverage: { some: { serviceZoneId: ride.destinationServiceZoneId, serviceType: "PASSENGER_RIDE", isEnabled: true } } },
            ],
            assignments: { none: { status: { in: ACTIVE_ASSIGNMENTS } } },
          },
          data: { isAvailable: false },
        });
        if (reserved.count !== 1) throw failure(409, "DRIVER_NO_LONGER_AVAILABLE", "The driver is no longer available. Select another fare.");
        const changedRide = await tx.rideBooking.updateMany({
          where: { id: ride.id, passengerId: user.id, status: "MATCHING" },
          data: {
            status: "AWAITING_PAYMENT", driverFareMinor: fare, customerPayableMinor: payable,
            fareAcceptanceIdempotencyKey: idempotencyKey, fareAcceptancePayloadHash: payloadHash,
          },
        });
        if (changedRide.count !== 1) throw failure(409, "RIDE_STATE_CONFLICT", "The ride changed while accepting the fare.");
        const accepted = await tx.driverOffer.updateMany({
          where: { id: offer.id, rideBookingId: ride.id, status: "OFFERED", proposedFareMinor: fare, expiresAt: { gt: now } },
          data: { status: "ACCEPTED", respondedAt: now },
        });
        if (accepted.count !== 1) throw failure(409, "OFFER_NO_LONGER_AVAILABLE", "The selected fare is no longer available.");
        await tx.driverOffer.updateMany({
          where: { rideBookingId: ride.id, id: { not: offer.id }, status: "OFFERED" },
          data: { status: "WITHDRAWN", respondedAt: now },
        });
        const assignment = await tx.driverAssignment.create({
          data: {
            rideBookingId: ride.id, driverProfileId: offer.driverProfileId, assignedByUserId: user.id,
            status: "AWAITING_PAYMENT", agreedFareMinor: fare, currency: ride.currency, reservedAt: now, paymentExpiresAt,
          },
          select: { id: true },
        });
        await tx.bookingEvent.create({
          data: {
            rideBookingId: ride.id, actorUserId: user.id, eventType: "RIDE_FARE_ACCEPTED",
            fromStatus: "MATCHING", toStatus: "AWAITING_PAYMENT",
            metadata: {
              offerId: offer.id, assignmentId: assignment.id, driverFareMinor: fare.toString(),
              connectionFeeMinor: ride.connectionFeeMinor.toString(), customerPayableMinor: payable.toString(),
              paymentExpiresAt: paymentExpiresAt.toISOString(),
            },
          },
        });
        return {
          rideBookingId: ride.id, status: "AWAITING_PAYMENT", assignmentId: assignment.id,
          driverFareMinor: fare.toString(), connectionFeeMinor: ride.connectionFeeMinor.toString(),
          customerPayableMinor: payable.toString(), currency: ride.currency, paymentExpiresAt, replay: false,
        };
      });
    },
  };
}

import { createHash } from "node:crypto";

function payloadHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const ACTIVE_ASSIGNMENT_STATUSES = ["AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"];

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function forbidden(message = "You do not have permission to perform this action.") {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = "FORBIDDEN";
  return error;
}

function serializeOffer(offer) {
  const driver = offer.driverProfile;
  return {
    id: offer.id,
    status: offer.status,
    proposedFareMinor: offer.proposedFareMinor == null ? null : offer.proposedFareMinor.toString(),
    currency: offer.currency,
    expiresAt: offer.expiresAt,
    createdAt: offer.createdAt,
    driver: driver ? {
      displayName: driver.user?.fullName ?? "Logistic Hub driver",
      averageRating: driver.averageRating == null ? null : driver.averageRating.toString(),
      completedJobs: driver.completedJobs,
    } : undefined,
  };
}

export function createDispatchService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async requestParcelMatching({ bookingId, user }) {
      const now = clock();
      return prismaClient.$transaction(async (tx) => {
        const booking = await tx.parcelBooking.findUnique({ where: { id: bookingId } });
        if (!booking) return null;
        if (booking.senderId !== user.id) throw forbidden();
        if (booking.status === "MATCHING") {
          const offersCreated = await tx.driverOffer.count({
            where: { parcelBookingId: booking.id, status: "OFFERED", expiresAt: { gt: now } },
          });
          const latest = await tx.driverOffer.aggregate({
            where: { parcelBookingId: booking.id },
            _max: { expiresAt: true },
          });
          return {
            bookingId: booking.id,
            status: "MATCHING",
            offersCreated,
            offersExpireAt: latest._max.expiresAt,
          };
        }
        if (booking.status !== "DRAFT") {
          throw conflict("BOOKING_STATE_CONFLICT", "Only a draft booking can request driver offers.");
        }

        const drivers = await tx.driverProfile.findMany({
          where: {
            verificationStatus: "VERIFIED",
            isOnline: true,
            isAvailable: true,
            user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
            vehicles: { some: { isActive: true, verificationStatus: "VERIFIED" } },
            AND: [
              {
                coverage: {
                  some: {
                    serviceZoneId: booking.pickupServiceZoneId,
                    serviceType: "PARCEL_DELIVERY",
                    isEnabled: true,
                  },
                },
              },
              {
                coverage: {
                  some: {
                    serviceZoneId: booking.destinationServiceZoneId,
                    serviceType: "PARCEL_DELIVERY",
                    isEnabled: true,
                  },
                },
              },
            ],
            assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
          },
          select: { id: true },
        });

        if (drivers.length === 0) {
          throw conflict("NO_ELIGIBLE_DRIVERS", "No verified, available drivers currently cover the pickup zone.");
        }

        const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
        const created = await tx.driverOffer.createMany({
          data: drivers.map(({ id }) => ({
            parcelBookingId: booking.id,
            driverProfileId: id,
            status: "OFFERED",
            currency: booking.currency,
            expiresAt,
          })),
        });
        const updated = await tx.parcelBooking.updateMany({
          where: { id: booking.id, senderId: user.id, status: "DRAFT" },
          data: { status: "MATCHING" },
        });
        if (updated.count !== 1) {
          throw conflict("BOOKING_STATE_CONFLICT", "The booking changed while matching was being requested.");
        }
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            actorUserId: user.id,
            eventType: "PARCEL_MATCHING_REQUESTED",
            fromStatus: "DRAFT",
            toStatus: "MATCHING",
            metadata: { offersCreated: created.count, expiresAt: expiresAt.toISOString() },
          },
        });
        return { bookingId: booking.id, status: "MATCHING", offersCreated: created.count, offersExpireAt: expiresAt };
      });
    },

    async listParcelOffers({ bookingId, user }) {
      const booking = await prismaClient.parcelBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, senderId: true },
      });
      if (!booking) return null;
      if (booking.senderId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) throw forbidden();

      const offers = await prismaClient.driverOffer.findMany({
        where: {
          parcelBookingId: booking.id,
          status: { in: ["OFFERED", "ACCEPTED"] },
          proposedFareMinor: { not: null },
        },
        include: {
          driverProfile: {
            select: {
              averageRating: true,
              completedJobs: true,
              user: { select: { fullName: true } },
            },
          },
        },
        orderBy: [{ proposedFareMinor: "asc" }, { createdAt: "asc" }],
      });
      return offers.map(serializeOffer);
    },

    async listDriverOffers({ userId }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
        throw forbidden("A verified, online and available driver profile is required.");
      }

      const offers = await prismaClient.driverOffer.findMany({
        where: {
          driverProfileId: profile.id,
          status: "OFFERED",
          proposedFareMinor: null,
          expiresAt: { gt: clock() },
          parcelBooking: { is: { status: "MATCHING" } },
        },
        include: {
          parcelBooking: {
            select: {
              id: true,
              publicReference: true,
              currency: true,
              pickupAddress: true,
              destinationAddress: true,
              parcelCategory: true,
              parcelSize: true,
              pickupServiceZoneId: true,
              destinationServiceZoneId: true,
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
        booking: offer.parcelBooking,
      }));
    },

    async proposeParcelFare({ offerId, userId, proposedFareMinor, idempotencyKey }) {
      const now = clock();
      const fare = BigInt(proposedFareMinor);
      return prismaClient.$transaction(async (tx) => {
        const profile = await tx.driverProfile.findUnique({
          where: { userId },
          select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
        });
        if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
          throw forbidden("A verified, online and available driver profile is required.");
        }

        const offer = await tx.driverOffer.findUnique({
          where: { id: offerId },
          include: { parcelBooking: true },
        });
        if (!offer || offer.driverProfileId !== profile.id || !offer.parcelBookingId) {
          const error = new Error("The driver offer was not found.");
          error.statusCode = 404;
          error.code = "NOT_FOUND";
          throw error;
        }
        const proposalHash = payloadHash({ offerId, proposedFareMinor });
        if (offer.fareProposalIdempotencyKey === idempotencyKey) {
          if (offer.fareProposalPayloadHash !== proposalHash) {
            throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
          }
          return {
            offerId: offer.id,
            proposedFareMinor: offer.proposedFareMinor?.toString() ?? proposedFareMinor,
            currency: offer.currency,
            status: offer.status,
          };
        }
        if (offer.proposedFareMinor != null) {
          throw conflict("OFFER_ALREADY_PROPOSED", "A fare proposal has already been submitted for this offer.");
        }
        if (offer.status !== "OFFERED" || offer.expiresAt <= now || offer.parcelBooking.status !== "MATCHING") {
          throw conflict("OFFER_NO_LONGER_AVAILABLE", "This offer is no longer available for a fare proposal.");
        }

        const snapshot = offer.parcelBooking.pricingSnapshot ?? {};
        const minimum = BigInt(snapshot.minimumDriverFareMinor ?? "0");
        if (fare < minimum) {
          const error = new Error("The proposed fare is below the configured minimum for this service.");
          error.statusCode = 400;
          error.code = "FARE_BELOW_MINIMUM";
          throw error;
        }

        const updated = await tx.driverOffer.updateMany({
          where: {
            id: offer.id,
            driverProfileId: profile.id,
            status: "OFFERED",
            proposedFareMinor: null,
            expiresAt: { gt: now },
          },
          data: {
            proposedFareMinor: fare,
            respondedAt: now,
            fareProposalIdempotencyKey: idempotencyKey,
            fareProposalPayloadHash: proposalHash,
          },
        });
        if (updated.count !== 1) throw conflict("OFFER_NO_LONGER_AVAILABLE", "This offer is no longer available.");
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: offer.parcelBookingId,
            actorUserId: userId,
            eventType: "DRIVER_FARE_PROPOSED",
            fromStatus: "MATCHING",
            toStatus: "MATCHING",
            metadata: { offerId: offer.id, proposedFareMinor: fare.toString(), currency: offer.currency },
          },
        });
        return { offerId: offer.id, proposedFareMinor: fare.toString(), currency: offer.currency, status: "OFFERED" };
      });
    },

    async acceptParcelFare({ bookingId, user, offerId, idempotencyKey }) {
      const now = clock();
      return prismaClient.$transaction(async (tx) => {
        const booking = await tx.parcelBooking.findUnique({ where: { id: bookingId } });
        if (!booking) return null;
        if (booking.senderId !== user.id) throw forbidden();
        const acceptanceHash = payloadHash({ bookingId, offerId });
        if (booking.fareAcceptanceIdempotencyKey === idempotencyKey) {
          if (booking.fareAcceptancePayloadHash !== acceptanceHash) {
            throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare acceptance.");
          }
          const assignment = await tx.driverAssignment.findFirst({
            where: { parcelBookingId: booking.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, paymentExpiresAt: true },
          });
          return {
            bookingId: booking.id,
            status: booking.status,
            assignmentId: assignment?.id ?? null,
            driverFareMinor: booking.driverFareMinor?.toString() ?? null,
            connectionFeeMinor: booking.connectionFeeMinor.toString(),
            otherChargesMinor: booking.otherChargesMinor.toString(),
            customerPayableMinor: booking.customerPayableMinor?.toString() ?? null,
            currency: booking.currency,
            paymentExpiresAt: assignment?.paymentExpiresAt ?? null,
            replay: true,
          };
        }
        if (booking.status !== "MATCHING") {
          throw conflict("BOOKING_STATE_CONFLICT", "A fare can only be accepted while the booking is matching.");
        }

        const offer = await tx.driverOffer.findUnique({ where: { id: offerId } });
        if (!offer || offer.parcelBookingId !== booking.id || offer.status !== "OFFERED"
          || offer.proposedFareMinor == null || offer.expiresAt <= now) {
          throw conflict("OFFER_NO_LONGER_AVAILABLE", "The selected fare proposal is invalid or expired.");
        }
        const fare = offer.proposedFareMinor;
        const minimum = BigInt(booking.pricingSnapshot?.minimumDriverFareMinor ?? "0");
        if (fare <= 0n || fare < minimum) {
          throw conflict("INVALID_FARE", "The selected driver fare is invalid or below the configured minimum.");
        }
        const customerPayable = fare + booking.connectionFeeMinor + booking.otherChargesMinor;
        const paymentExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);

        const driverReserved = await tx.driverProfile.updateMany({
          where: {
            id: offer.driverProfileId,
            verificationStatus: "VERIFIED",
            isOnline: true,
            isAvailable: true,
            user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
            vehicles: { some: { isActive: true, verificationStatus: "VERIFIED" } },
            AND: [
              { coverage: { some: { serviceZoneId: booking.pickupServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true } } },
              { coverage: { some: { serviceZoneId: booking.destinationServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true } } },
            ],
            assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
          },
          data: { isAvailable: false },
        });
        if (driverReserved.count !== 1) {
          throw conflict("DRIVER_NO_LONGER_AVAILABLE", "The driver is no longer available. Select another fare proposal.");
        }

        const accepted = await tx.driverOffer.updateMany({
          where: {
            id: offer.id,
            parcelBookingId: booking.id,
            status: "OFFERED",
            proposedFareMinor: fare,
            expiresAt: { gt: now },
          },
          data: { status: "ACCEPTED", respondedAt: now },
        });
        if (accepted.count !== 1) throw conflict("OFFER_NO_LONGER_AVAILABLE", "The selected fare proposal is no longer available.");

        const updatedBooking = await tx.parcelBooking.updateMany({
          where: { id: booking.id, senderId: user.id, status: "MATCHING" },
          data: {
            status: "AWAITING_PAYMENT",
            driverFareMinor: fare,
            customerPayableMinor: customerPayable,
            fareAcceptanceIdempotencyKey: idempotencyKey,
            fareAcceptancePayloadHash: acceptanceHash,
          },
        });
        if (updatedBooking.count !== 1) throw conflict("BOOKING_STATE_CONFLICT", "The booking changed while accepting the fare.");

        await tx.driverOffer.updateMany({
          where: { parcelBookingId: booking.id, id: { not: offer.id }, status: "OFFERED" },
          data: { status: "WITHDRAWN", respondedAt: now },
        });
        const assignment = await tx.driverAssignment.create({
          data: {
            parcelBookingId: booking.id,
            driverProfileId: offer.driverProfileId,
            assignedByUserId: user.id,
            status: "AWAITING_PAYMENT",
            agreedFareMinor: fare,
            currency: booking.currency,
            reservedAt: now,
            paymentExpiresAt,
          },
          select: { id: true },
        });
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            actorUserId: user.id,
            eventType: "DRIVER_FARE_ACCEPTED",
            fromStatus: "MATCHING",
            toStatus: "AWAITING_PAYMENT",
            metadata: {
              offerId: offer.id,
              assignmentId: assignment.id,
              driverFareMinor: fare.toString(),
              connectionFeeMinor: booking.connectionFeeMinor.toString(),
              customerPayableMinor: customerPayable.toString(),
              paymentExpiresAt: paymentExpiresAt.toISOString(),
            },
          },
        });

        return {
          bookingId: booking.id,
          status: "AWAITING_PAYMENT",
          assignmentId: assignment.id,
          driverFareMinor: fare.toString(),
          connectionFeeMinor: booking.connectionFeeMinor.toString(),
          otherChargesMinor: booking.otherChargesMinor.toString(),
          customerPayableMinor: customerPayable.toString(),
          currency: booking.currency,
          paymentExpiresAt,
        };
      });
    },
  };
}

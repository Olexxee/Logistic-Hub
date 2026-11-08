import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { activeDriverCapabilityWhere, activeDriverDocumentWhere, activeServiceZoneWhere, eligibleParcelDriverWhere, eligibleVehicleWhere } from "../drivers/driver-dispatch-eligibility.js";

function payloadHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const ACTIVE_ASSIGNMENT_STATUSES = ["AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"];
const MAX_DRIVER_LOCATION_AGE_MS = env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000;

export function distanceBetweenCoordinatesMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isDriverWithinPickupRadius(driver, pickup, now = new Date()) {
  const latestLocation = driver.locations?.[0];
  if (!latestLocation || !driver.lastLocationAt || !driver.serviceRadiusMeters) return false;
  const nowMs = now.getTime();
  const cutoff = nowMs - MAX_DRIVER_LOCATION_AGE_MS;
  const profileLocationAt = new Date(driver.lastLocationAt).getTime();
  const recordedAt = new Date(latestLocation.recordedAt).getTime();
  if (!Number.isFinite(profileLocationAt) || !Number.isFinite(recordedAt)) return false;
  if (profileLocationAt < cutoff || profileLocationAt > nowMs) return false;
  if (recordedAt < cutoff || recordedAt > nowMs) return false;
  const distance = distanceBetweenCoordinatesMeters(
    Number(latestLocation.latitude), Number(latestLocation.longitude),
    Number(pickup.latitude), Number(pickup.longitude),
  );
  return distance <= driver.serviceRadiusMeters;
}

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
    vehicle: offer.vehicle ? { type: offer.vehicle.type, make: offer.vehicle.make, model: offer.vehicle.model } : null,
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
            replay: true,
          };
        }
        if (booking.status !== "DRAFT") {
          throw conflict("BOOKING_STATE_CONFLICT", "Only a draft booking can request driver offers.");
        }

        const requestedZoneIds = [...new Set([booking.pickupServiceZoneId, booking.destinationServiceZoneId])];
        const activeZones = await tx.serviceZone.findMany({
          where: {
            id: { in: requestedZoneIds },
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
        if (activeZones.length !== requestedZoneIds.length) {
          throw conflict("SERVICE_ZONE_UNAVAILABLE", "Pickup and destination zones must both be active for parcel delivery.");
        }
        if (new Set(activeZones.map((zone) => zone.stateId)).size !== 1) {
          throw conflict("PARTNER_QUOTE_REQUIRED", "Cross-state parcel shipments require an accepted transport-partner quote; direct local-driver matching is not available for this route.");
        }

        const drivers = await tx.driverProfile.findMany({
          where: {
            ...eligibleParcelDriverWhere({
              capability: "LOCAL_DISPATCH",
              now,
              strictMode: env.DRIVER_KYC_MODE === "STRICT",
              kycTiers: env.DRIVER_KYC_MODE === "TEST" ? ["FULL", "TEST_LIMITED"] : ["FULL"],
            }),
            lastLocationAt: {
              gte: new Date(now.getTime() - MAX_DRIVER_LOCATION_AGE_MS),
              lte: now,
            },
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
          select: {
            id: true,
            serviceRadiusMeters: true,
            lastLocationAt: true,
            locations: {
              orderBy: { recordedAt: "desc" },
              take: 1,
              select: { latitude: true, longitude: true, recordedAt: true },
            },
          },
        });
        const eligibleDrivers = drivers.filter((driver) => isDriverWithinPickupRadius(driver, {
          latitude: booking.pickupLatitude,
          longitude: booking.pickupLongitude,
        }, now));

        if (eligibleDrivers.length === 0) {
          throw conflict("NO_ELIGIBLE_DRIVERS", "No verified, available drivers with fresh locations inside their pickup radius cover both service zones.");
        }

        const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
        const created = await tx.driverOffer.createMany({
          data: eligibleDrivers.map(({ id }) => ({
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
            metadata: { offersCreated: created.count, eligibleDrivers: eligibleDrivers.length, expiresAt: expiresAt.toISOString() },
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
          vehicle: { select: { type: true, make: true, model: true } },
        },
        orderBy: [{ proposedFareMinor: "asc" }, { createdAt: "asc" }],
      });
      return offers.map(serializeOffer);
    },

    async listDriverOffers({ userId }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED" || profile.suspendedAt || !(profile.kycTier === "FULL" || (env.DRIVER_KYC_MODE === "TEST" && profile.kycTier === "TEST_LIMITED")) || !profile.isOnline || !profile.isAvailable) {
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
              parcelCategory: true,
              parcelSize: true,
              pickupServiceZone: { select: { name: true } },
              destinationServiceZone: { select: { name: true } },
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

    async proposeParcelFare({ offerId, userId, vehicleId, proposedFareMinor, idempotencyKey }) {
      const now = clock();
      const fare = BigInt(proposedFareMinor);
      try {
        return await prismaClient.$transaction(async (tx) => {
        const profile = await tx.driverProfile.findUnique({
          where: { userId },
          select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true },
        });
        if (!profile || profile.verificationStatus !== "VERIFIED" || profile.suspendedAt || !(profile.kycTier === "FULL" || (env.DRIVER_KYC_MODE === "TEST" && profile.kycTier === "TEST_LIMITED")) || !profile.isOnline || !profile.isAvailable) {
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
        const proposalHash = payloadHash({ offerId, vehicleId, proposedFareMinor });
        if (offer.fareProposalIdempotencyKey === idempotencyKey) {
          if (offer.fareProposalPayloadHash !== proposalHash) {
            throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
          }
          return {
            offerId: offer.id,
            vehicleId: offer.vehicleId,
            proposedFareMinor: offer.proposedFareMinor?.toString() ?? proposedFareMinor,
            currency: offer.currency,
            status: offer.status,
            replay: true,
          };
        }
        if (offer.proposedFareMinor != null) {
          throw conflict("OFFER_ALREADY_PROPOSED", "A fare proposal has already been submitted for this offer.");
        }
        const driverGrant = await tx.driverCapabilityGrant.findFirst({
          where: { driverProfileId: profile.id, capability: "LOCAL_DISPATCH", status: "APPROVED" },
          select: { id: true },
        });
        if (!driverGrant) throw conflict("DRIVER_CAPABILITY_NOT_APPROVED", "Your LOCAL_DISPATCH capability is not approved.");
        const eligibleVehicles = vehicleId
          ? await tx.vehicle.findMany({ where: { id: vehicleId, ...eligibleVehicleWhere({ driverProfileId: profile.id, capability: "LOCAL_DISPATCH", now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }) }, select: { id: true }, take: 2 })
          : await tx.vehicle.findMany({ where: eligibleVehicleWhere({ driverProfileId: profile.id, capability: "LOCAL_DISPATCH", now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }), select: { id: true }, take: 2 });
        if (!eligibleVehicles.length) throw conflict("VEHICLE_NOT_ELIGIBLE", "Select one of your active, verified vehicles before proposing a fare.");
        if (eligibleVehicles.length > 1) throw conflict("VEHICLE_SELECTION_REQUIRED", "Select the vehicle you will use for this delivery.");
        const vehicle = eligibleVehicles[0];
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
            vehicleId: vehicle.id,
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
            metadata: { offerId: offer.id, vehicleId: vehicle.id, proposedFareMinor: fare.toString(), currency: offer.currency },
          },
        });
        return { offerId: offer.id, vehicleId: vehicle.id, proposedFareMinor: fare.toString(), currency: offer.currency, status: "OFFERED" };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await prismaClient.driverOffer.findUnique({
          where: { fareProposalIdempotencyKey: idempotencyKey },
        });
        if (!existing) throw error;
        const expectedHash = payloadHash({ offerId, vehicleId, proposedFareMinor });
        if (existing.id !== offerId || existing.fareProposalPayloadHash !== expectedHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
        }
        return {
          offerId: existing.id,
          vehicleId: existing.vehicleId,
          proposedFareMinor: existing.proposedFareMinor?.toString() ?? proposedFareMinor,
          currency: existing.currency,
          status: existing.status,
          replay: true,
        };
      }
    },

    async acceptParcelFare({ bookingId, user, offerId, idempotencyKey }) {
      const now = clock();
      try {
        return await prismaClient.$transaction(async (tx) => {
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
            select: { id: true, paymentExpiresAt: true, deliveryLegId: true },
          });
          return {
            bookingId: booking.id,
            status: booking.status,
            assignmentId: assignment?.id ?? null,
            deliveryLegId: assignment?.deliveryLegId ?? null,
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
        if (!offer.vehicleId) throw conflict("VEHICLE_NOT_SELECTED", "The driver has not selected a vehicle for this offer.");
        const selectedVehicle = await tx.vehicle.findFirst({
          where: { id: offer.vehicleId, ...eligibleVehicleWhere({ driverProfileId: offer.driverProfileId, capability: "LOCAL_DISPATCH", now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }) },
          select: { id: true },
        });
        const driverGrant = await tx.driverCapabilityGrant.findFirst({
          where: { driverProfileId: offer.driverProfileId, capability: "LOCAL_DISPATCH", status: "APPROVED" },
          select: { id: true },
        });
        if (!driverGrant) throw conflict("DRIVER_CAPABILITY_NO_LONGER_APPROVED", "The selected driver is no longer approved for local dispatch.");
        if (!selectedVehicle) throw conflict("VEHICLE_NO_LONGER_ELIGIBLE", "The selected vehicle is no longer active and verified.");
        if (fare <= 0n || fare < minimum) {
          throw conflict("INVALID_FARE", "The selected driver fare is invalid or below the configured minimum.");
        }
        const requestedZoneIds = [...new Set([booking.pickupServiceZoneId, booking.destinationServiceZoneId])];
        const activeZones = await tx.serviceZone.findMany({
          where: { id: { in: requestedZoneIds }, ...activeServiceZoneWhere(now) },
          select: { id: true, stateId: true },
        });
        if (activeZones.length !== requestedZoneIds.length) {
          throw conflict("SERVICE_ZONE_UNAVAILABLE", "Pickup and destination zones must remain active and available for parcel delivery.");
        }
        if (new Set(activeZones.map((zone) => zone.stateId)).size !== 1) {
          throw conflict("PARTNER_QUOTE_REQUIRED", "Cross-state parcel shipments require an accepted transport-partner quote.");
        }

        const customerPayable = fare + booking.connectionFeeMinor + booking.otherChargesMinor;
        const paymentExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);

        const driverReserved = await tx.driverProfile.updateMany({
          where: {
            id: offer.driverProfileId,
            verificationStatus: "VERIFIED",
            kycTier: { in: env.DRIVER_KYC_MODE === "TEST" ? ["FULL", "TEST_LIMITED"] : ["FULL"] },
            suspendedAt: null,
            isOnline: true,
            isAvailable: true,
            user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
            ...activeDriverCapabilityWhere("LOCAL_DISPATCH"),
            ...activeDriverDocumentWhere(now, env.DRIVER_KYC_MODE === "STRICT"),
            vehicles: { some: { id: offer.vehicleId, ...eligibleVehicleWhere({ capability: "LOCAL_DISPATCH", now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }) } },
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
        const deliveryLeg = await tx.deliveryLeg.create({
          data: {
            parcelBookingId: booking.id,
            sequence: 1,
            type: "DIRECT",
            status: "AWAITING_PAYMENT",
            originServiceZoneId: booking.pickupServiceZoneId,
            destinationServiceZoneId: booking.destinationServiceZoneId,
            plannedAt: now,
          },
          select: { id: true },
        });
        const assignment = await tx.driverAssignment.create({
          data: {
            parcelBookingId: booking.id,
            deliveryLegId: deliveryLeg.id,
            driverProfileId: offer.driverProfileId,
            vehicleId: offer.vehicleId,
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
              vehicleId: offer.vehicleId,
              assignmentId: assignment.id,
              deliveryLegId: deliveryLeg.id,
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
          deliveryLegId: deliveryLeg.id,
          driverFareMinor: fare.toString(),
          connectionFeeMinor: booking.connectionFeeMinor.toString(),
          otherChargesMinor: booking.otherChargesMinor.toString(),
          customerPayableMinor: customerPayable.toString(),
          currency: booking.currency,
          paymentExpiresAt,
        };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await prismaClient.parcelBooking.findUnique({
          where: { fareAcceptanceIdempotencyKey: idempotencyKey },
        });
        if (!existing) throw error;
        const expectedHash = payloadHash({ bookingId, offerId });
        if (existing.id !== bookingId || existing.fareAcceptancePayloadHash !== expectedHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare acceptance.");
        }
        const assignment = await prismaClient.driverAssignment.findFirst({
          where: { parcelBookingId: existing.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, paymentExpiresAt: true, deliveryLegId: true },
        });
        return {
          bookingId: existing.id,
          status: existing.status,
          assignmentId: assignment?.id ?? null,
          deliveryLegId: assignment?.deliveryLegId ?? null,
          driverFareMinor: existing.driverFareMinor?.toString() ?? null,
          connectionFeeMinor: existing.connectionFeeMinor.toString(),
          otherChargesMinor: existing.otherChargesMinor.toString(),
          customerPayableMinor: existing.customerPayableMinor?.toString() ?? null,
          currency: existing.currency,
          paymentExpiresAt: assignment?.paymentExpiresAt ?? null,
          replay: true,
        };
      }
    },
  };
}

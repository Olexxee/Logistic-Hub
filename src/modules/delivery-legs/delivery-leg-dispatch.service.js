import { createHash } from "node:crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";
import { createDeliveryLegDispatchRepository } from "./delivery-leg-dispatch.repository.js";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED",
  "IN_PROGRESS", "ARRIVED_AT_DESTINATION",
];
const DRIVER_LEG_TYPES = new Set(["LOCAL_PICKUP", "FINAL_MILE"]);

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function distanceMeters(aLat, aLon, bLat, bLon) {
  const radians = (v) => v * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function conflict(code, message) {
  return new ConflictError(message, code);
}
function assertEligibleDriver(driver, leg, now) {
  if (!driver || driver.verificationStatus !== "VERIFIED" || !driver.isOnline || !driver.isAvailable) return false;
  if (!driver.lastLocationAt || driver.lastLocationAt > now || driver.lastLocationAt < new Date(now.getTime() - 5 * 60_000)) return false;
  const location = driver.locations?.[0];
  if (!location || location.recordedAt > now || location.recordedAt < new Date(now.getTime() - 5 * 60_000)) return false;
  const originLat = Number(leg.originLatitude);
  const originLon = Number(leg.originLongitude);
  if (!Number.isFinite(originLat) || !Number.isFinite(originLon)) return false;
  return distanceMeters(originLat, originLon, Number(location.latitude), Number(location.longitude))
    <= driver.serviceRadiusMeters;
}
function serializeDriverOffer(offer) {
  const leg = offer.deliveryLeg;
  return {
    id: offer.id,
    currency: offer.currency,
    expiresAt: offer.expiresAt,
    createdAt: offer.createdAt,
    deliveryLeg: {
      id: leg.id,
      sequence: leg.sequence,
      type: leg.type,
      origin: { serviceZone: leg.originServiceZone.name, hub: leg.originHubPoint?.name ?? null },
      destination: { serviceZone: leg.destinationServiceZone.name, hub: leg.destinationHubPoint?.name ?? null },
      booking: {
        publicReference: leg.parcelBooking.publicReference,
        parcelCategory: leg.parcelBooking.parcelCategory,
        parcelSize: leg.parcelBooking.parcelSize,
      },
    },
  };
}
function serializeCustomerOffer(offer) {
  return {
    id: offer.id,
    status: offer.status,
    proposedFareMinor: offer.proposedFareMinor.toString(),
    currency: offer.currency,
    expiresAt: offer.expiresAt,
    driver: {
      displayName: offer.driverProfile.user?.fullName ?? "Logistic Hub driver",
      averageRating: offer.driverProfile.averageRating?.toString() ?? null,
      completedJobs: offer.driverProfile.completedJobs,
    },
  };
}

export function createDeliveryLegDispatchService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createDeliveryLegDispatchRepository(prismaClient);

  return {
    async requestOffers({ legId, user }) {
      const now = clock();
      return db.transaction(async (tx) => {
        const leg = await db.findLeg(tx, legId);
        if (!leg) throw new NotFoundError("Delivery leg not found.");
        if (leg.parcelBooking.senderId !== user.id) throw new ForbiddenError();
        if (!DRIVER_LEG_TYPES.has(leg.type)) {
          throw conflict("LEG_REQUIRES_PARTNER_EXECUTION", "This delivery leg is not eligible for local driver assignment.");
        }
        if (leg.status !== "READY_FOR_ASSIGNMENT") {
          throw conflict("DELIVERY_LEG_NOT_READY", "Driver offers can only be requested for a leg that is ready for assignment.");
        }
        const existing = await db.listActiveOffers(tx, leg.id, now);
        if (existing.length) {
          return { deliveryLegId: leg.id, status: leg.status, offersCreated: existing.length, replay: true };
        }
        const drivers = await db.findEligibleDrivers(tx, leg, now);
        const eligible = drivers.filter((driver) => assertEligibleDriver(driver, leg, now));
        if (!eligible.length) {
          throw conflict("NO_ELIGIBLE_DRIVERS", "No verified, available drivers with fresh locations inside their pickup radius cover this leg.");
        }
        const expiresAt = new Date(now.getTime() + 20 * 60_000);
        const created = await db.createOffers(tx, eligible.map((driver) => ({
          deliveryLegId: leg.id,
          driverProfileId: driver.id,
          status: "OFFERED",
          currency: leg.parcelBooking.currency,
          expiresAt,
        })));
        await db.recordEvent(tx, {
          bookingId: leg.parcelBookingId,
          actorUserId: user.id,
          eventType: "DELIVERY_LEG_MATCHING_REQUESTED",
          fromStatus: leg.status,
          toStatus: leg.status,
          metadata: { deliveryLegId: leg.id, sequence: leg.sequence, offersCreated: created.count, expiresAt: expiresAt.toISOString() },
        });
        return { deliveryLegId: leg.id, status: leg.status, offersCreated: created.count, offersExpireAt: expiresAt };
      });
    },

    async listDriverOffers({ userId }) {
      const profile = await db.findDriverProfile(userId);
      if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
        throw new ForbiddenError("A verified, online and available driver profile is required.");
      }
      return (await db.findDriverOffers(profile.id, clock())).map(serializeDriverOffer);
    },

    async proposeFare({ offerId, userId, proposedFareMinor, idempotencyKey }) {
      const now = clock();
      const fare = BigInt(proposedFareMinor);
      const proposalHash = hash({ offerId, proposedFareMinor });
      try {
        return await db.transaction(async (tx) => {
          const profile = await tx.driverProfile.findUnique({
            where: { userId },
            select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
          });
          if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline || !profile.isAvailable) {
            throw new ForbiddenError("A verified, online and available driver profile is required.");
          }
          const offer = await db.findOfferForDriver(tx, offerId);
          if (!offer || offer.driverProfileId !== profile.id) throw new NotFoundError("Delivery-leg offer not found.");
          if (offer.proposalIdempotencyKey === idempotencyKey) {
            if (offer.proposalPayloadHash !== proposalHash) throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
            return { offerId, proposedFareMinor: offer.proposedFareMinor.toString(), currency: offer.currency, status: offer.status, replay: true };
          }
          if (offer.status !== "OFFERED" || offer.proposedFareMinor != null
            || offer.expiresAt <= now || offer.deliveryLeg.status !== "READY_FOR_ASSIGNMENT") {
            throw conflict("OFFER_NO_LONGER_AVAILABLE", "This delivery-leg offer is no longer available for a fare proposal.");
          }
          const updated = await db.updateOffer(tx, {
            id: offer.id, driverProfileId: profile.id, status: "OFFERED",
            proposedFareMinor: null, expiresAt: { gt: now },
          }, {
            proposedFareMinor: fare,
            respondedAt: now,
            proposalIdempotencyKey: idempotencyKey,
            proposalPayloadHash: proposalHash,
          });
          if (updated.count !== 1) throw conflict("OFFER_NO_LONGER_AVAILABLE", "This delivery-leg offer is no longer available.");
          await db.recordEvent(tx, {
            bookingId: offer.deliveryLeg.parcelBookingId,
            actorUserId: userId,
            eventType: "DELIVERY_LEG_FARE_PROPOSED",
            fromStatus: offer.deliveryLeg.status,
            toStatus: offer.deliveryLeg.status,
            metadata: { deliveryLegId: offer.deliveryLegId, offerId, proposedFareMinor: fare.toString(), currency: offer.currency },
          });
          return { offerId, proposedFareMinor: fare.toString(), currency: offer.currency, status: "OFFERED" };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await db.findOfferByProposalKey(idempotencyKey);
        if (!existing || existing.id !== offerId || existing.proposalPayloadHash !== proposalHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
        }
        return { offerId, proposedFareMinor: existing.proposedFareMinor.toString(), currency: existing.currency, status: existing.status, replay: true };
      }
    },

    async listCustomerOffers({ bookingId, legId, user }) {
      const booking = await db.findBookingForCustomer(bookingId);
      if (!booking) throw new NotFoundError("Parcel booking not found.");
      if (booking.senderId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) throw new ForbiddenError();
      return (await db.findCustomerOffers(bookingId, legId)).map(serializeCustomerOffer);
    },

    async acceptFare({ bookingId, legId, offerId, user, idempotencyKey }) {
      const now = clock();
      const acceptanceHash = hash({ bookingId, legId, offerId });
      try {
        const priorAcceptance = await db.findOfferByAcceptanceKey(idempotencyKey);
      if (priorAcceptance) {
        if (priorAcceptance.deliveryLegId !== legId || priorAcceptance.acceptancePayloadHash !== acceptanceHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare acceptance.");
        }
        const priorAssignment = await prismaClient.driverAssignment.findFirst({
          where: { deliveryLegId: legId, driverProfileId: priorAcceptance.driverProfileId },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, agreedFareMinor: true },
        });
        return {
          bookingId, deliveryLegId: legId, offerId: priorAcceptance.id,
          assignmentId: priorAssignment?.id ?? null,
          status: "AWAITING_PAYMENT",
          agreedFareMinor: priorAssignment?.agreedFareMinor?.toString() ?? priorAcceptance.proposedFareMinor.toString(),
          currency: priorAcceptance.currency, paymentRequired: true, paymentEnabled: false, replay: true,
        };
      }
      try {
        return await db.acceptOfferTransaction(async (tx) => {
          const booking = await tx.parcelBooking.findUnique({ where: { id: bookingId } });
          if (!booking) throw new NotFoundError("Parcel booking not found.");
          if (booking.senderId !== user.id) throw new ForbiddenError();
          const leg = await tx.deliveryLeg.findFirst({
            where: { id: legId, parcelBookingId: booking.id },
          });
          if (!leg) throw new NotFoundError("Delivery leg not found for this booking.");
          if (leg.status !== "READY_FOR_ASSIGNMENT" || !DRIVER_LEG_TYPES.has(leg.type)) {
            throw conflict("DELIVERY_LEG_NOT_READY", "This delivery leg is not ready for driver fare acceptance.");
          }
          const offer = await tx.deliveryLegOffer.findUnique({ where: { id: offerId } });
          if (!offer || offer.deliveryLegId !== leg.id || offer.status !== "OFFERED"
            || offer.proposedFareMinor == null || offer.expiresAt <= now) {
            throw conflict("OFFER_NO_LONGER_AVAILABLE", "The selected driver fare is invalid or expired.");
          }
          if (offer.acceptanceIdempotencyKey === idempotencyKey) {
            if (offer.acceptancePayloadHash !== acceptanceHash) throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare acceptance.");
            const assignment = await tx.driverAssignment.findFirst({
              where: { deliveryLegId: leg.id, driverProfileId: offer.driverProfileId },
              orderBy: { createdAt: "desc" },
              select: { id: true, status: true, agreedFareMinor: true },
            });
            return {
              bookingId, deliveryLegId: leg.id, offerId,
              assignmentId: assignment?.id ?? null,
              status: leg.status,
              agreedFareMinor: assignment?.agreedFareMinor?.toString() ?? offer.proposedFareMinor.toString(),
              currency: offer.currency, paymentRequired: true, paymentEnabled: false, replay: true,
            };
          }
          const driverReserved = await tx.driverProfile.updateMany({
            where: {
              id: offer.driverProfileId,
              verificationStatus: "VERIFIED", isOnline: true, isAvailable: true,
              lastLocationAt: { gte: new Date(now.getTime() - 5 * 60_000), lte: now },
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
          if (driverReserved.count !== 1) throw conflict("DRIVER_NO_LONGER_AVAILABLE", "The selected driver is no longer available.");
          const accepted = await tx.deliveryLegOffer.updateMany({
            where: { id: offer.id, deliveryLegId: leg.id, status: "OFFERED", proposedFareMinor: offer.proposedFareMinor, expiresAt: { gt: now } },
            data: {
              status: "ACCEPTED", respondedAt: now,
              acceptanceIdempotencyKey: idempotencyKey,
              acceptancePayloadHash: acceptanceHash,
            },
          });
          if (accepted.count !== 1) throw conflict("OFFER_NO_LONGER_AVAILABLE", "The selected driver fare is no longer available.");
          await tx.deliveryLegOffer.updateMany({
            where: { deliveryLegId: leg.id, id: { not: offer.id }, status: "OFFERED" },
            data: { status: "WITHDRAWN", respondedAt: now },
          });
          const legUpdated = await tx.deliveryLeg.updateMany({
            where: { id: leg.id, status: "READY_FOR_ASSIGNMENT" },
            data: { status: "AWAITING_PAYMENT" },
          });
          if (legUpdated.count !== 1) throw conflict("DELIVERY_LEG_STATE_CONFLICT", "The delivery leg changed while accepting the fare.");
          const assignment = await tx.driverAssignment.create({
            data: {
              parcelBookingId: booking.id,
              deliveryLegId: leg.id,
              driverProfileId: offer.driverProfileId,
              assignedByUserId: user.id,
              status: "AWAITING_PAYMENT",
              agreedFareMinor: offer.proposedFareMinor,
              currency: offer.currency,
              reservedAt: now,
              paymentExpiresAt: new Date(now.getTime() + 15 * 60_000),
            },
            select: { id: true },
          });
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: booking.id,
              actorUserId: user.id,
              eventType: "DELIVERY_LEG_FARE_ACCEPTED",
              fromStatus: "READY_FOR_ASSIGNMENT",
              toStatus: "AWAITING_PAYMENT",
              metadata: {
                deliveryLegId: leg.id, assignmentId: assignment.id, offerId,
                agreedFareMinor: offer.proposedFareMinor.toString(),
                currency: offer.currency,
                paymentRequired: true,
                paymentEnabled: false,
              },
            },
          });
          return {
            bookingId, deliveryLegId: leg.id, offerId, assignmentId: assignment.id,
            status: "AWAITING_PAYMENT",
            agreedFareMinor: offer.proposedFareMinor.toString(),
            currency: offer.currency,
            paymentRequired: true,
            paymentEnabled: false,
          };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await db.findOfferByAcceptanceKey(idempotencyKey);
        if (!existing || existing.deliveryLegId !== legId || existing.acceptancePayloadHash !== acceptanceHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare acceptance.");
        }
        const assignment = await prismaClient.driverAssignment.findFirst({
          where: { deliveryLegId: legId, driverProfileId: existing.driverProfileId },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, agreedFareMinor: true },
        });
        return {
          bookingId, deliveryLegId: legId, offerId: existing.id,
          assignmentId: assignment?.id ?? null,
          status: "AWAITING_PAYMENT",
          agreedFareMinor: assignment?.agreedFareMinor?.toString() ?? existing.proposedFareMinor.toString(),
          currency: existing.currency, paymentRequired: true, paymentEnabled: false, replay: true,
        };
      }
    },
  };
}

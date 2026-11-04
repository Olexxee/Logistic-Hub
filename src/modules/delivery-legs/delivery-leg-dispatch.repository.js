import { env } from "../../config/env.js";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED",
  "IN_PROGRESS", "ARRIVED_AT_DESTINATION",
];

export function createDeliveryLegDispatchRepository(prismaClient) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    transaction(callback) {
      return prismaClient.$transaction(callback);
    },
    findLeg(tx, legId) {
      return tx.deliveryLeg.findUnique({
        where: { id: legId },
        include: {
          parcelBooking: {
            select: {
              id: true, senderId: true, publicReference: true, status: true,
              currency: true, parcelCategory: true, parcelSize: true,
              pickupLatitude: true, pickupLongitude: true,
              destinationLatitude: true, destinationLongitude: true,
            },
          },
          originServiceZone: { select: { id: true, name: true } },
          destinationServiceZone: { select: { id: true, name: true } },
          originHubPoint: { select: { id: true, name: true } },
          destinationHubPoint: { select: { id: true, name: true } },
        },
      });
    },
    findEligibleDrivers(tx, leg, now) {
      return tx.driverProfile.findMany({
        where: {
          verificationStatus: "VERIFIED",
          kycTier: { in: env.DRIVER_KYC_MODE === "TEST" ? ["FULL", "TEST_LIMITED"] : ["FULL"] },
          suspendedAt: null,
          isOnline: true,
          isAvailable: true,
          lastLocationAt: { gte: new Date(now.getTime() - 5 * 60_000), lte: now },
          user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
          vehicles: { some: { isActive: true, verificationStatus: "VERIFIED" } },
          AND: [
            { coverage: { some: { serviceZoneId: leg.originServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true } } },
            { coverage: { some: { serviceZoneId: leg.destinationServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true } } },
          ],
          assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
        },
        select: {
          id: true,
          verificationStatus: true,
          isOnline: true,
          isAvailable: true,
          serviceRadiusMeters: true,
          lastLocationAt: true,
          locations: {
            orderBy: { recordedAt: "desc" },
            take: 1,
            select: { latitude: true, longitude: true, recordedAt: true },
          },
        },
      });
    },
    listActiveOffers(tx, legId, now) {
      return tx.deliveryLegOffer.findMany({
        where: { deliveryLegId: legId, status: "OFFERED", expiresAt: { gt: now } },
        select: { id: true },
      });
    },
    createOffers(tx, data) {
      return tx.deliveryLegOffer.createMany({ data });
    },
    recordEvent(tx, { bookingId, actorUserId, eventType, fromStatus, toStatus, metadata }) {
      return tx.bookingEvent.create({
        data: { parcelBookingId: bookingId, actorUserId, eventType, fromStatus, toStatus, metadata },
      });
    },
    findDriverProfile(userId) {
      return prismaClient.driverProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true },
      });
    },
    findDriverOffers(profileId, now) {
      return prismaClient.deliveryLegOffer.findMany({
        where: {
          driverProfileId: profileId,
          status: "OFFERED",
          proposedFareMinor: null,
          expiresAt: { gt: now },
          deliveryLeg: { is: { status: "READY_FOR_ASSIGNMENT" } },
        },
        include: {
          deliveryLeg: {
            include: {
              parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true } },
              originServiceZone: { select: { name: true } },
              destinationServiceZone: { select: { name: true } },
              originHubPoint: { select: { name: true } },
              destinationHubPoint: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    },
    findOfferForDriver(tx, offerId) {
      return tx.deliveryLegOffer.findUnique({
        where: { id: offerId },
        include: {
          deliveryLeg: {
            include: { parcelBooking: true },
          },
        },
      });
    },
    updateOffer(tx, where, data) {
      return tx.deliveryLegOffer.updateMany({ where, data });
    },
    findOfferByProposalKey(key) {
      return prismaClient.deliveryLegOffer.findUnique({ where: { proposalIdempotencyKey: key } });
    },
    findOfferByAcceptanceKey(key) {
      return prismaClient.deliveryLegOffer.findUnique({
        where: { acceptanceIdempotencyKey: key },
        include: { deliveryLeg: true },
      });
    },
    findCustomerOffers(bookingId, legId) {
      return prismaClient.deliveryLegOffer.findMany({
        where: {
          deliveryLegId: legId,
          deliveryLeg: { is: { parcelBookingId: bookingId } },
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
    },
    findBookingForCustomer(bookingId) {
      return prismaClient.parcelBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, senderId: true },
      });
    },
    acceptOfferTransaction(callback) {
      return prismaClient.$transaction(callback);
    },
  };
}

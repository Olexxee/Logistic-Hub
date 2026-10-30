import { createDiscoveryRepository } from "./discovery.repository.js";

const ACTIVE_DRIVER_ASSIGNMENT_STATUSES = [
  "ACCEPTED",
  "ARRIVED_AT_PICKUP",
  "PICKUP_CONFIRMED",
  "IN_PROGRESS",
  "ARRIVED_AT_DESTINATION",
];

function serializeAssignment(item) {
  const booking = item.parcelBooking ?? item.rideBooking;
  return {
    id: item.id,
    status: item.status,
    agreedFareMinor: item.agreedFareMinor.toString(),
    currency: item.currency,
    acceptedAt: item.acceptedAt,
    pickupAt: item.pickupAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    booking: booking ? {
      id: booking.id,
      publicReference: booking.publicReference,
      status: booking.status,
      bookingType: item.parcelBooking ? "PARCEL" : "RIDE",
      pickupAddress: booking.pickupAddress ?? booking.pickupLocation,
      destinationAddress: booking.destinationAddress ?? booking.destinationLocation,
      recipientName: item.parcelBooking ? booking.recipientName : null,
      recipientPhone: item.parcelBooking ? booking.recipientPhone : null,
    } : null,
    deliveryLeg: item.deliveryLeg ? {
      id: item.deliveryLeg.id,
      sequence: item.deliveryLeg.sequence,
      type: item.deliveryLeg.type,
      status: item.deliveryLeg.status,
      originServiceZone: item.deliveryLeg.originServiceZone,
      destinationServiceZone: item.deliveryLeg.destinationServiceZone,
      originHubPoint: item.deliveryLeg.originHubPoint,
      destinationHubPoint: item.deliveryLeg.destinationHubPoint,
    } : null,
  };
}

function serializePaymentAttempt(attempt) {
  return {
    id: attempt.id,
    provider: attempt.provider,
    status: attempt.status,
    amountMinor: attempt.amountMinor.toString(),
    currency: attempt.currency,
    initializedAt: attempt.initializedAt,
    verifiedAt: attempt.verifiedAt,
    failedAt: attempt.failedAt,
    booking: attempt.parcelBooking ? {
      id: attempt.parcelBooking.id,
      publicReference: attempt.parcelBooking.publicReference,
      bookingType: "PARCEL",
      status: attempt.parcelBooking.status,
      paymentStatus: attempt.parcelBooking.paymentStatus,
    } : attempt.rideBooking ? {
      id: attempt.rideBooking.id,
      publicReference: attempt.rideBooking.publicReference,
      bookingType: "RIDE",
      status: attempt.rideBooking.status,
      paymentStatus: attempt.rideBooking.paymentStatus,
    } : null,
  };
}

export function createDiscoveryService({ prismaClient, repository = createDiscoveryRepository(prismaClient) }) {
  return {
    async listDriverAssignments({ userId, limit }) {
      const profile = await repository.findDriverProfile(userId);
      if (!profile) return { items: [], pagination: { limit, hasMore: false, nextCursor: null } };
      const rows = await repository.listDriverAssignments({ driverProfileId: profile.id, limit: limit + 1, statuses: ACTIVE_DRIVER_ASSIGNMENT_STATUSES });
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      return {
        items: items.map(serializeAssignment),
        pagination: { limit, hasMore, nextCursor: hasMore ? items.at(-1)?.id ?? null : null },
      };
    },

    async listUserPartnerMemberships({ userId }) {
      return { items: await repository.listUserPartnerMemberships(userId) };
    },

    async listUserHubMemberships({ userId }) {
      return { items: await repository.listUserHubMemberships(userId) };
    },

    async searchUsers({ query, role, status, page, limit }) {
      const result = await repository.searchUsers({ query, role, status, skip: (page - 1) * limit, take: limit });
      return {
        items: result.items,
        pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
      };
    },

    async listAdminQuotes({ status, partnerId, bookingId, page, limit }) {
      const result = await repository.listAdminQuotes({ status, partnerId, bookingId, skip: (page - 1) * limit, take: limit });
      return {
        items: result.items.map(quote => ({
          id: quote.id,
          version: quote.version,
          status: quote.status,
          currency: quote.currency,
          transportChargeMinor: quote.transportChargeMinor.toString(),
          collectionChargeMinor: quote.collectionChargeMinor.toString(),
          hubHandlingChargeMinor: quote.hubHandlingChargeMinor.toString(),
          destinationDeliveryChargeMinor: quote.destinationDeliveryChargeMinor.toString(),
          platformChargeMinor: quote.platformChargeMinor.toString(),
          otherChargesMinor: quote.otherChargesMinor.toString(),
          totalCustomerChargeMinor: quote.totalCustomerChargeMinor.toString(),
          expiresAt: quote.expiresAt,
          offeredAt: quote.offeredAt,
          acceptedAt: quote.acceptedAt,
          booking: {
            id: quote.parcelBooking.id,
            publicReference: quote.parcelBooking.publicReference,
            status: quote.parcelBooking.status,
            paymentStatus: quote.parcelBooking.paymentStatus,
            pickupServiceZone: quote.parcelBooking.pickupServiceZone,
            destinationServiceZone: quote.parcelBooking.destinationServiceZone,
          },
          partner: quote.partnerAgreement?.partner ? {
            id: quote.partnerAgreement.partner.id,
            displayName: quote.partnerAgreement.partner.displayName,
          } : null,
        })),
        pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
      };
    },

    async getPaymentAttempt({ paymentAttemptId, user }) {
      const attempt = await repository.findPaymentAttempt(paymentAttemptId);
      if (!attempt) return null;
      const ownerId = attempt.parcelBooking?.senderId ?? attempt.rideBooking?.passengerId;
      if (user.id !== ownerId && !["ADMIN", "SUPPORT"].includes(user.role)) {
        const error = new Error("You do not have permission to view this payment attempt.");
        error.statusCode = 403;
        error.code = "FORBIDDEN";
        throw error;
      }
      return serializePaymentAttempt(attempt);
    },
  };
}

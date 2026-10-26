import { createHash, randomBytes } from "node:crypto";

const ACTIVE_PARCEL_AVAILABILITY = (now) => ({
  serviceType: "PARCEL_DELIVERY",
  isEnabled: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

function requestHash(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function publicReference() {
  return `LH-PCL-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function serializeBooking(booking) {
  return {
    id: booking.id,
    publicReference: booking.publicReference,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    currency: booking.currency,
    pickupServiceZoneId: booking.pickupServiceZoneId,
    destinationServiceZoneId: booking.destinationServiceZoneId,
    pickupAddress: booking.pickupAddress,
    pickupLatitude: String(booking.pickupLatitude),
    pickupLongitude: String(booking.pickupLongitude),
    pickupInstructions: booking.pickupInstructions,
    destinationAddress: booking.destinationAddress,
    destinationLatitude: String(booking.destinationLatitude),
    destinationLongitude: String(booking.destinationLongitude),
    recipientName: booking.recipientName,
    recipientPhone: booking.recipientPhone,
    parcelCategory: booking.parcelCategory,
    parcelDescription: booking.parcelDescription,
    parcelSize: booking.parcelSize,
    declaredValueMinor: booking.declaredValueMinor == null ? null : booking.declaredValueMinor.toString(),
    handlingInstructions: booking.handlingInstructions,
    driverFareMinor: booking.driverFareMinor == null ? null : booking.driverFareMinor.toString(),
    connectionFeeMinor: booking.connectionFeeMinor.toString(),
    otherChargesMinor: booking.otherChargesMinor.toString(),
    customerPayableMinor: booking.customerPayableMinor == null ? null : booking.customerPayableMinor.toString(),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

export function createParcelBookingsService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function findExistingByIdempotencyKey(key, hash) {
    const existing = await prismaClient.parcelBooking.findUnique({ where: { idempotencyKey: key } });
    if (!existing) return null;
    if (existing.idempotencyPayloadHash !== hash) {
      const error = new Error("The Idempotency-Key was already used with a different request.");
      error.statusCode = 409;
      error.code = "IDEMPOTENCY_CONFLICT";
      throw error;
    }
    return { booking: serializeBooking(existing), replay: true };
  }

  return {
    async createDraft({ senderId, idempotencyKey, input }) {
      const hash = requestHash(input);
      const existing = await findExistingByIdempotencyKey(idempotencyKey, hash);
      if (existing) return existing;

      if (input.pickupServiceZoneId === input.destinationServiceZoneId) {
        // Same-zone deliveries are valid, so no rejection here; this branch intentionally remains a no-op.
      }

      const now = clock();
      const zoneIds = [...new Set([input.pickupServiceZoneId, input.destinationServiceZoneId])];
      const zones = await prismaClient.serviceZone.findMany({
        where: {
          id: { in: zoneIds },
          isActive: true,
          state: { isActive: true, country: { isActive: true } },
          availability: { some: ACTIVE_PARCEL_AVAILABILITY(now) },
        },
        select: { id: true },
      });
      if (zones.length !== zoneIds.length) {
        const error = new Error("One or both requested zones are not active for parcel delivery.");
        error.statusCode = 409;
        error.code = "SERVICE_ZONE_UNAVAILABLE";
        throw error;
      }

      const pricingRules = await prismaClient.pricingRule.findMany({
        where: {
          serviceType: "PARCEL_DELIVERY",
          isActive: true,
          effectiveFrom: { lte: now },
          AND: [
            { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
            { OR: [{ serviceZoneId: input.pickupServiceZoneId }, { serviceZoneId: null }] },
          ],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      const pricingRule = pricingRules.find((rule) => rule.serviceZoneId === input.pickupServiceZoneId)
        ?? pricingRules.find((rule) => rule.serviceZoneId == null);
      if (!pricingRule) {
        const error = new Error("Parcel pricing is not configured for the pickup zone.");
        error.statusCode = 409;
        error.code = "PRICING_UNAVAILABLE";
        throw error;
      }

      const bookingData = {
        publicReference: publicReference(),
        idempotencyKey,
        idempotencyPayloadHash: hash,
        senderId,
        pickupServiceZoneId: input.pickupServiceZoneId,
        destinationServiceZoneId: input.destinationServiceZoneId,
        status: "DRAFT",
        paymentStatus: "INITIALIZED",
        currency: pricingRule.currency,
        pickupAddress: input.pickupAddress,
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        pickupInstructions: input.pickupInstructions,
        destinationAddress: input.destinationAddress,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        parcelCategory: input.parcelCategory,
        parcelDescription: input.parcelDescription,
        parcelSize: input.parcelSize,
        declaredValueMinor: input.declaredValueMinor == null ? undefined : BigInt(input.declaredValueMinor),
        handlingInstructions: input.handlingInstructions,
        driverFareMinor: null,
        connectionFeeMinor: pricingRule.fixedConnectionFeeMinor,
        otherChargesMinor: 0n,
        customerPayableMinor: null,
        pricingRuleId: pricingRule.id,
        pricingSnapshot: {
          pricingRuleId: pricingRule.id,
          version: pricingRule.version,
          serviceType: "PARCEL_DELIVERY",
          currency: pricingRule.currency,
          fixedConnectionFeeMinor: pricingRule.fixedConnectionFeeMinor.toString(),
          minimumDriverFareMinor: pricingRule.minimumDriverFareMinor.toString(),
          calculation: "The driver fare is proposed separately and must be accepted by the sender before payment.",
        },
      };

      try {
        const booking = await prismaClient.$transaction(async (tx) => {
          const created = await tx.parcelBooking.create({ data: bookingData });
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: created.id,
              actorUserId: senderId,
              eventType: "PARCEL_BOOKING_CREATED",
              fromStatus: null,
              toStatus: "DRAFT",
              metadata: { publicReference: created.publicReference },
            },
          });
          return created;
        });
        return { booking: serializeBooking(booking), replay: false };
      } catch (error) {
        if (error.code === "P2002") {
          const replay = await findExistingByIdempotencyKey(idempotencyKey, hash);
          if (replay) return replay;
        }
        throw error;
      }
    },

    async getVisibleBooking({ bookingId, user }) {
      const booking = await prismaClient.parcelBooking.findUnique({ where: { id: bookingId } });
      if (!booking) return null;
      const privileged = ["ADMIN", "SUPPORT"].includes(user.role);
      if (!privileged && booking.senderId !== user.id) {
        const error = new Error("You do not have permission to view this booking.");
        error.statusCode = 403;
        error.code = "FORBIDDEN";
        throw error;
      }
      return serializeBooking(booking);
    },
  };
}

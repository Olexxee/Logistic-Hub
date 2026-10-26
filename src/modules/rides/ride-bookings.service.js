import { createHash, randomBytes } from "node:crypto";

function requestHash(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function publicReference() {
  return `LH-RID-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function serializeRide(ride) {
  return {
    id: ride.id,
    publicReference: ride.publicReference,
    status: ride.status,
    paymentStatus: ride.paymentStatus,
    currency: ride.currency,
    pickupServiceZoneId: ride.pickupServiceZoneId,
    destinationServiceZoneId: ride.destinationServiceZoneId,
    pickupAddress: ride.pickupAddress,
    pickupLatitude: String(ride.pickupLatitude),
    pickupLongitude: String(ride.pickupLongitude),
    destinationAddress: ride.destinationAddress,
    destinationLatitude: String(ride.destinationLatitude),
    destinationLongitude: String(ride.destinationLongitude),
    vehicleType: ride.vehicleType,
    driverFareMinor: ride.driverFareMinor == null ? null : ride.driverFareMinor.toString(),
    connectionFeeMinor: ride.connectionFeeMinor.toString(),
    customerPayableMinor: ride.customerPayableMinor == null ? null : ride.customerPayableMinor.toString(),
    pricingSnapshot: ride.pricingSnapshot,
    paidAt: ride.paidAt,
    createdAt: ride.createdAt,
    updatedAt: ride.updatedAt,
  };
}

const activeRideAvailability = (now) => ({
  serviceType: "PASSENGER_RIDE",
  isEnabled: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

export function createRideBookingsService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function existingByKey(key, hash, passengerId) {
    const ride = await prismaClient.rideBooking.findUnique({ where: { idempotencyKey: key } });
    if (!ride) return null;
    if (ride.passengerId !== passengerId || ride.idempotencyPayloadHash !== hash) {
      throw httpError(409, "IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different request.");
    }
    return { ride: serializeRide(ride), replay: true };
  }

  return {
    async createDraft({ passengerId, idempotencyKey, input }) {
      const hash = requestHash(input);
      const existing = await existingByKey(idempotencyKey, hash, passengerId);
      if (existing) return existing;

      const now = clock();
      const zoneIds = [...new Set([input.pickupServiceZoneId, input.destinationServiceZoneId])];
      const zones = await prismaClient.serviceZone.findMany({
        where: {
          id: { in: zoneIds },
          isActive: true,
          state: { isActive: true, country: { isActive: true } },
          availability: { some: activeRideAvailability(now) },
        },
        select: { id: true },
      });
      if (zones.length !== zoneIds.length) {
        throw httpError(409, "SERVICE_ZONE_UNAVAILABLE", "One or both requested zones are not active for passenger rides.");
      }

      const rules = await prismaClient.pricingRule.findMany({
        where: {
          serviceType: "PASSENGER_RIDE",
          isActive: true,
          effectiveFrom: { lte: now },
          AND: [
            { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
            { OR: [{ serviceZoneId: input.pickupServiceZoneId }, { serviceZoneId: null }] },
          ],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      const rule = rules.find((item) => item.serviceZoneId === input.pickupServiceZoneId)
        ?? rules.find((item) => item.serviceZoneId == null);
      if (!rule) throw httpError(409, "PRICING_UNAVAILABLE", "Passenger ride pricing is not configured for the pickup zone.");

      const data = {
        publicReference: publicReference(),
        idempotencyKey,
        idempotencyPayloadHash: hash,
        passengerId,
        pickupServiceZoneId: input.pickupServiceZoneId,
        destinationServiceZoneId: input.destinationServiceZoneId,
        status: "DRAFT",
        paymentStatus: "INITIALIZED",
        currency: rule.currency,
        pickupAddress: input.pickupAddress,
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        destinationAddress: input.destinationAddress,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        vehicleType: input.vehicleType,
        driverFareMinor: null,
        connectionFeeMinor: rule.fixedConnectionFeeMinor,
        customerPayableMinor: null,
        pricingSnapshot: {
          pricingRuleId: rule.id,
          version: rule.version,
          serviceType: "PASSENGER_RIDE",
          currency: rule.currency,
          fixedConnectionFeeMinor: rule.fixedConnectionFeeMinor.toString(),
          minimumDriverFareMinor: rule.minimumDriverFareMinor.toString(),
          calculation: "The driver fare is proposed separately and must be accepted by the passenger before payment.",
        },
      };

      try {
        const ride = await prismaClient.$transaction(async (tx) => {
          const created = await tx.rideBooking.create({ data });
          await tx.bookingEvent.create({
            data: {
              rideBookingId: created.id,
              actorUserId: passengerId,
              eventType: "RIDE_BOOKING_CREATED",
              fromStatus: null,
              toStatus: "DRAFT",
              metadata: { publicReference: created.publicReference, pricingRuleId: rule.id },
            },
          });
          return created;
        });
        return { ride: serializeRide(ride), replay: false };
      } catch (error) {
        if (error.code === "P2002") {
          const retry = await existingByKey(idempotencyKey, hash, passengerId);
          if (retry) return retry;
        }
        throw error;
      }
    },

    async getVisibleRide({ rideBookingId, user }) {
      const ride = await prismaClient.rideBooking.findUnique({ where: { id: rideBookingId } });
      if (!ride) return null;
      if (ride.passengerId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) {
        throw httpError(403, "FORBIDDEN", "You do not have permission to view this ride booking.");
      }
      return serializeRide(ride);
    },
  };
}

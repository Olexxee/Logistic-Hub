import { createHash, randomBytes } from "node:crypto";
import { createRideBookingsRepository } from "./ride-bookings.repository.js";
import { ConflictError, ForbiddenError } from "../../shared/http/app-error.js";

function requestHash(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
function publicReference() {
  return `LH-RID-${randomBytes(6).toString("hex").toUpperCase()}`;
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

export function createRideBookingsService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createRideBookingsRepository({ prismaClient });

  async function existingByKey(key, hash, passengerId) {
    const ride = await db.findByIdempotencyKey(key);
    if (!ride) return null;
    if (ride.passengerId !== passengerId || ride.idempotencyPayloadHash !== hash) {
      throw new ConflictError("The Idempotency-Key was already used with a different request.", "IDEMPOTENCY_CONFLICT");
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
      const zones = await db.findActiveRideZones(zoneIds, now);
      if (zones.length !== zoneIds.length) {
        throw new ConflictError("One or both requested zones are not active for passenger rides.", "SERVICE_ZONE_UNAVAILABLE");
      }

      const rules = await db.findApplicablePricingRules(input.pickupServiceZoneId, now);
      const rule = rules.find((item) => item.serviceZoneId === input.pickupServiceZoneId)
        ?? rules.find((item) => item.serviceZoneId == null);
      if (!rule) {
        throw new ConflictError("Passenger ride pricing is not configured for the pickup zone.", "PRICING_UNAVAILABLE");
      }

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
        const ride = await db.createWithEvent(data, {
          actorUserId: passengerId,
          metadata: { publicReference: data.publicReference, pricingRuleId: rule.id },
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
      const ride = await db.findById(rideBookingId);
      if (!ride) return null;
      if (ride.passengerId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) {
        throw new ForbiddenError("You do not have permission to view this ride booking.");
      }
      return serializeRide(ride);
    },
  };
}

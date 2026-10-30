import { createHash, randomBytes } from "node:crypto";
import { createParcelBookingsRepository } from "./parcel-bookings.repository.js";
import { ConflictError, ForbiddenError } from "../../shared/http/app-error.js";

function requestHash(input) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
function publicReference() { return `LH-PCL-${randomBytes(6).toString("hex").toUpperCase()}`; }
function serializeDeliveryLeg(leg) {
  const assignment = leg.assignments?.[0] ?? null;
  return {
    id: leg.id,
    sequence: leg.sequence,
    type: leg.type,
    status: leg.status,
    origin: leg.originServiceZone,
    destination: leg.destinationServiceZone,
    plannedAt: leg.plannedAt,
    assignedAt: leg.assignedAt,
    startedAt: leg.startedAt,
    completedAt: leg.completedAt,
    failureReason: leg.failureReason,
    assignment: assignment ? {
      id: assignment.id,
      status: assignment.status,
      acceptedAt: assignment.acceptedAt,
      pickupAt: assignment.pickupAt,
      startedAt: assignment.startedAt,
      completedAt: assignment.completedAt,
    } : null,
    createdAt: leg.createdAt,
    updatedAt: leg.updatedAt,
  };
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

export function createParcelBookingsService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createParcelBookingsRepository({ prismaClient });
  async function findExistingByIdempotencyKey(key, hash, senderId) {
    const existing = await db.findByIdempotencyKey(key);
    if (!existing) return null;
    if (existing.senderId !== senderId || existing.idempotencyPayloadHash !== hash) {
      throw new ConflictError("The Idempotency-Key was already used with a different request.", "IDEMPOTENCY_CONFLICT");
    }
    return { booking: serializeBooking(existing), replay: true };
  }
  return {
    async createDraft({ senderId, idempotencyKey, input }) {
      const hash = requestHash(input);
      const existing = await findExistingByIdempotencyKey(idempotencyKey, hash, senderId);
      if (existing) return existing;
      const now = clock();
      const zoneIds = [...new Set([input.pickupServiceZoneId, input.destinationServiceZoneId])];
      const zones = await db.findActiveParcelZones(zoneIds, now);
      if (zones.length !== zoneIds.length) {
        throw new ConflictError("One or both requested zones are not active for parcel delivery.", "SERVICE_ZONE_UNAVAILABLE");
      }
      const pricingRules = await db.findApplicablePricingRules(input.pickupServiceZoneId, now);
      const pricingRule = pricingRules.find((rule) => rule.serviceZoneId === input.pickupServiceZoneId)
        ?? pricingRules.find((rule) => rule.serviceZoneId == null);
      if (!pricingRule) throw new ConflictError("Parcel pricing is not configured for the pickup zone.", "PRICING_UNAVAILABLE");

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
        const booking = await db.createWithEvent(bookingData, {
          actorUserId: senderId,
          metadata: { publicReference: bookingData.publicReference, pricingRuleId: pricingRule.id },
        });
        return { booking: serializeBooking(booking), replay: false };
      } catch (error) {
        if (error.code === "P2002") {
          const replay = await findExistingByIdempotencyKey(idempotencyKey, hash, senderId);
          if (replay) return replay;
        }
        throw error;
      }
    },
    async getVisibleBooking({ bookingId, user }) {
      const booking = await db.findById(bookingId);
      if (!booking) return null;
      if (!["ADMIN", "SUPPORT"].includes(user.role) && booking.senderId !== user.id) {
        throw new ForbiddenError("You do not have permission to view this booking.");
      }
      return serializeBooking(booking);
    },
    async listVisibleDeliveryLegs({ bookingId, user }) {
      const booking = await db.findById(bookingId);
      if (!booking) return null;
      if (!["ADMIN", "SUPPORT"].includes(user.role) && booking.senderId !== user.id) {
        throw new ForbiddenError("You do not have permission to view this booking.");
      }
      const legs = await db.findDeliveryLegsByBookingId(bookingId);
      return legs.map(serializeDeliveryLeg);
    },
    async listVisibleBookings({ user, page, limit, status }) {
      const includeAll = ["ADMIN", "SUPPORT"].includes(user.role);
      const result = await db.listVisible({
        senderId: user.id,
        includeAll,
        status,
        skip: (page - 1) * limit,
        take: limit,
      });
      return {
        items: result.items.map(serializeBooking),
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      };
    },
  };
}

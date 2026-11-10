import { createHash, randomBytes } from "node:crypto";
import { createParcelBookingsRepository } from "./parcel-bookings.repository.js";
import { ConflictError, ForbiddenError } from "../../shared/http/app-error.js";
import { prepareServiceZoneBoundaries, resolveServiceZoneForPoint } from "../geography/service-zone-resolution.js";

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
    originHub: leg.originHubPoint,
    destinationHub: leg.destinationHubPoint,
    plannedAt: leg.plannedAt,
    assignedAt: leg.assignedAt,
    pickedUpAt: leg.pickedUpAt,
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
    packages: (booking.parcelPackages ?? []).map(pkg => ({
      id: pkg.id,
      packageSequence: pkg.packageSequence,
      externalPackageRef: pkg.externalPackageRef,
      packageCategory: pkg.packageCategory,
      description: pkg.description,
      weightGrams: pkg.weightGrams,
      lengthMm: pkg.lengthMm,
      widthMm: pkg.widthMm,
      heightMm: pkg.heightMm,
      declaredValueMinor: pkg.declaredValueMinor == null ? null : pkg.declaredValueMinor.toString(),
      assessmentStatus: pkg.assessmentStatus,
      assessmentSource: pkg.assessmentSource,
      assessedAt: pkg.assessedAt,
    })),
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
      const serviceableZones = await db.findServiceableParcelZones(now);
      const preparedZones = prepareServiceZoneBoundaries(serviceableZones);
      const pickupResolution = resolveServiceZoneForPoint(preparedZones, input.pickup);
      const destinationResolution = resolveServiceZoneForPoint(preparedZones, input.destination);
      function requireResolvedZone(result, label) {
        if (result.status === "invalid-boundary") {
          throw new ConflictError("An active parcel zone has an invalid stored boundary and must be corrected by an administrator.", "SERVICE_ZONE_BOUNDARY_INVALID");
        }
        if (result.status === "ambiguous") {
          throw new ConflictError(`The ${label} coordinate falls in more than one active parcel service zone.`, "SERVICE_ZONE_AMBIGUOUS");
        }
        if (result.status !== "resolved") {
          throw new ConflictError(`The ${label} coordinate is outside active parcel service coverage.`, "SERVICE_ZONE_NOT_FOUND");
        }
        return result.zone;
      }
      const pickupZone = requireResolvedZone(pickupResolution, "Pickup");
      const destinationZone = requireResolvedZone(destinationResolution, "Destination");
      if (input.pickupServiceZoneId && input.pickupServiceZoneId !== pickupZone.id) {
        throw new ConflictError("The supplied pickup zone no longer matches the server-resolved coordinate.", "SERVICE_ZONE_RESOLUTION_MISMATCH");
      }
      if (input.destinationServiceZoneId && input.destinationServiceZoneId !== destinationZone.id) {
        throw new ConflictError("The supplied destination zone no longer matches the server-resolved coordinate.", "SERVICE_ZONE_RESOLUTION_MISMATCH");
      }
      const pickupServiceZoneId = pickupZone.id;
      const destinationServiceZoneId = destinationZone.id;
      const pricingRules = await db.findApplicablePricingRules(pickupServiceZoneId, now);
      const pricingRule = pricingRules.find((rule) => rule.serviceZoneId === pickupServiceZoneId)
        ?? pricingRules.find((rule) => rule.serviceZoneId == null);
      // Draft creation records shipment facts. Route-aware pricing is assessed
      // separately; the legacy zone rule is optional and is not a customer tariff.

      const packages = (input.packages ?? [{
        packageCategory: input.parcelCategory,
        description: input.parcelDescription,
        weightGrams: input.weightGrams,
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        declaredValueMinor: input.declaredValueMinor,
      }]).map((pkg, index) => ({
        packageSequence: index + 1,
        externalPackageRef: pkg.externalPackageRef,
        packageCategory: pkg.packageCategory,
        description: pkg.description,
        weightGrams: pkg.weightGrams ?? null,
        lengthMm: pkg.lengthMm ?? null,
        widthMm: pkg.widthMm ?? null,
        heightMm: pkg.heightMm ?? null,
        declaredValueMinor: pkg.declaredValueMinor == null ? null : BigInt(pkg.declaredValueMinor),
        assessmentStatus: pkg.weightGrams == null ? "REQUIRES_MEASUREMENT" : "DECLARED",
        assessmentSource: "CUSTOMER_DECLARED",
      }));
      const bookingData = {
        publicReference: publicReference(),
        idempotencyKey,
        idempotencyPayloadHash: hash,
        senderId,
        pickupServiceZoneId,
        destinationServiceZoneId,
        status: "DRAFT",
        paymentStatus: "INITIALIZED",
        currency: pricingRule?.currency ?? "NGN",
        pickupAddress: input.pickupAddress,
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        pickupInstructions: input.pickupInstructions,
        destinationAddress: input.destinationAddress,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        parcelCategory: input.packages ? null : input.parcelCategory,
        parcelDescription: input.packages ? null : input.parcelDescription,
        parcelSize: input.packages ? null : input.parcelSize,
        declaredValueMinor: input.declaredValueMinor == null ? undefined : BigInt(input.declaredValueMinor),
        handlingInstructions: input.handlingInstructions,
        driverFareMinor: null,
        connectionFeeMinor: pricingRule?.fixedConnectionFeeMinor ?? 0n,
        otherChargesMinor: 0n,
        customerPayableMinor: null,
        pricingRuleId: pricingRule.id,
        pricingSnapshot: {
          pricingRuleId: pricingRule.id,
          version: pricingRule.version,
          serviceType: "PARCEL_DELIVERY",
          currency: pricingRule?.currency ?? "NGN",
          fixedConnectionFeeMinor: pricingRule.fixedConnectionFeeMinor.toString(),
          minimumDriverFareMinor: pricingRule.minimumDriverFareMinor.toString(),
          calculation: "The driver fare is proposed separately and must be accepted by the sender before payment.",
        },
      };
      try {
        const booking = await db.createWithEvent(bookingData, {
          actorUserId: senderId,
          metadata: { publicReference: bookingData.publicReference, pricingRuleId: pricingRule?.id ?? null, packageCount: packages.length },
          packages,
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
    async listVisibleBookings({ user, page, limit, status, paymentStatus, reference, pickupServiceZoneId, destinationServiceZoneId, createdFrom, createdTo }) {
      const includeAll = ["ADMIN", "SUPPORT"].includes(user.role);
      const hasAdminFilters = Boolean(paymentStatus || reference || pickupServiceZoneId || destinationServiceZoneId || createdFrom || createdTo);
      if (hasAdminFilters && !includeAll) {
        throw new ForbiddenError("Operational booking filters are available to admin and support users only.");
      }
      const result = await db.listVisible({
        senderId: user.id,
        includeAll,
        status,
        paymentStatus,
        reference,
        pickupServiceZoneId,
        destinationServiceZoneId,
        createdFrom: createdFrom ? new Date(createdFrom) : undefined,
        createdTo: createdTo ? new Date(createdTo) : undefined,
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

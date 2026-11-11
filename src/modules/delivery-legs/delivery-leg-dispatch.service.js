import { createHash } from "node:crypto";
import { projectIntegrationShipmentEvent } from "../integrations/integration-shipment-events.projector.js";
import { env } from "../../config/env.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";
import { createDeliveryLegDispatchRepository } from "./delivery-leg-dispatch.repository.js";
import { activeDriverCapabilityWhere, activeDriverDocumentWhere, activeServiceZoneWhere, eligibleVehicleWhere, parcelCapabilityForLegType } from "../drivers/driver-dispatch-eligibility.js";

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
  if (!driver || driver.verificationStatus !== "VERIFIED" || driver.suspendedAt || driver.kycTier !== "FULL" || !driver.isOnline || !driver.isAvailable) return false;
  if (!driver.lastLocationAt || driver.lastLocationAt > now || driver.lastLocationAt < new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000)) return false;
  const location = driver.locations?.[0];
  if (!location || location.recordedAt > now || location.recordedAt < new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000)) return false;
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
    ...(offer.fixedPayoutMinor != null ? { fixedPayoutMinor: offer.fixedPayoutMinor.toString() } : {}),
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
    vehicle: offer.vehicle ? { type: offer.vehicle.type, make: offer.vehicle.make, model: offer.vehicle.model } : null,
  };
}

export function createDeliveryLegDispatchService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createDeliveryLegDispatchRepository(prismaClient);

  return {
    async requestOffers({ legId, user, hubPointId }) {
      const now = clock();
      return db.transaction(async (tx) => {
        const leg = await db.findLeg(tx, legId);
        if (!leg) throw new NotFoundError("Delivery leg not found.");
        if (hubPointId) {
          if (leg.originHubPointId !== hubPointId) throw new ForbiddenError();
          const [hub, membership] = await Promise.all([
            tx.hubPoint.findUnique({ where: { id: hubPointId }, select: { id: true, status: true } }),
            tx.hubPointOperator.findUnique({
              where: { hubPointId_userId: { hubPointId, userId: user.id } },
            }),
          ]);
          if (hub?.status !== "ACTIVE" || !membership?.isActive || !membership.canDispatch) {
            throw new ForbiddenError("An active hub dispatch permission is required.");
          }
        } else if (user.role === "ADMIN") {
          const integrationDispatch = leg.parcelBooking.integrationClientId != null
            && leg.parcelBooking.senderId == null
            && leg.parcelBooking.integrationDispatchAuthorizedAt != null
            && leg.parcelBooking.paymentStatus === "SUCCEEDED"
            && leg.parcelBooking.status === "AWAITING_PARTNER_ASSIGNMENT";
          if (!integrationDispatch) {
            throw conflict("PLATFORM_DISPATCH_NOT_AUTHORIZED", "Admin dispatch requires a paid, released platform-priced integration shipment.");
          }
        } else if (leg.parcelBooking.senderId !== user.id) {
          throw new ForbiddenError();
        }
        if (leg.metadata?.pricingSource === "PLATFORM_ROUTE_RATE") {
          const fixedPayout = leg.type === "LOCAL_PICKUP"
            && leg.metadata?.driverPayoutMinor != null
            && BigInt(leg.metadata.driverPayoutMinor) > 0n
            && leg.parcelBooking.pricingSnapshot?.source === "PLATFORM_ROUTE_RATE"
            && leg.parcelBooking.pricingSnapshot?.quoteId === leg.metadata.quoteId
            && leg.parcelBooking.pricingSnapshot?.driverPayoutMinor === leg.metadata.driverPayoutMinor;
          const customerDispatch = user.role !== "ADMIN"
            && leg.parcelBooking.senderId === user.id
            && leg.parcelBooking.integrationClientId == null
            && leg.parcelBooking.status === "AWAITING_PARTNER_ASSIGNMENT"
            && ["INITIALIZED", "FAILED"].includes(leg.parcelBooking.paymentStatus);
          const integrationDispatch = user.role === "ADMIN"
            && leg.parcelBooking.integrationClientId != null
            && leg.parcelBooking.integrationDispatchAuthorizedAt != null
            && leg.parcelBooking.paymentStatus === "SUCCEEDED";
          if (!fixedPayout || !(customerDispatch || integrationDispatch)) {
            throw conflict("PLATFORM_DISPATCH_NOT_AUTHORIZED", "Platform fixed-payout dispatch requires an accepted tariff snapshot and the correct customer-payment or integration-release state.");
          }
        }
        if (!DRIVER_LEG_TYPES.has(leg.type)) {
          throw conflict("LEG_REQUIRES_PARTNER_EXECUTION", "This delivery leg is not eligible for local driver assignment.");
        }
        if (leg.status !== "READY_FOR_ASSIGNMENT") {
          throw conflict("DELIVERY_LEG_NOT_READY", "Driver offers can only be requested for a leg that is ready for assignment.");
        }
        if (leg.metadata?.pricingSource === "PLATFORM_ROUTE_RATE") {
          const routeAvailability = await tx.platformRouteAvailability.findFirst({
            where: {
              originServiceZoneId: leg.originServiceZoneId,
              destinationServiceZoneId: leg.destinationServiceZoneId,
              serviceType: "PARCEL_DELIVERY", isEnabled: true,
              AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
              ],
            },
            select: { id: true },
          });
          if (!routeAvailability) throw conflict("PLATFORM_ROUTE_UNAVAILABLE", "The platform-operated route is no longer enabled.");
        }
        const activeZones = await db.findActiveServiceZones(tx, leg, now);
        const requiredZoneCount = new Set([leg.originServiceZoneId, leg.destinationServiceZoneId]).size;
        if (activeZones.length !== requiredZoneCount) {
          throw conflict("SERVICE_ZONE_UNAVAILABLE", "The origin and destination zones must be active and available for parcel delivery.");
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
          ...(leg.metadata?.pricingSource === "PLATFORM_ROUTE_RATE"
            ? { fixedPayoutMinor: BigInt(leg.metadata.driverPayoutMinor) }
            : {}),
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
      if (!profile || profile.verificationStatus !== "VERIFIED" || profile.suspendedAt || profile.kycTier !== "FULL" || !profile.isOnline || !profile.isAvailable) {
        throw new ForbiddenError("A verified, online and available driver profile is required.");
      }
      return (await db.findDriverOffers(profile.id, clock())).map(serializeDriverOffer);
    },

    async proposeFare({ offerId, userId, vehicleId, proposedFareMinor, idempotencyKey }) {
      const now = clock();
      const fare = BigInt(proposedFareMinor);
      const proposalHash = hash({ offerId, vehicleId, proposedFareMinor });
      try {
        return await db.transaction(async (tx) => {
          const profile = await tx.driverProfile.findUnique({
            where: { userId },
            select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true },
          });
          if (!profile) throw new ForbiddenError("A verified driver profile is required.");
          const offer = await db.findOfferForDriver(tx, offerId);
          if (!offer || offer.driverProfileId !== profile.id) throw new NotFoundError("Delivery-leg offer not found.");
          // An idempotent retry must replay the original result even if the driver
          // became unavailable after the proposal was first committed.
          if (offer.proposalIdempotencyKey === idempotencyKey) {
            if (offer.proposalPayloadHash !== proposalHash) throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
            return { offerId, proposedFareMinor: offer.proposedFareMinor.toString(), currency: offer.currency, status: offer.status, replay: true };
          }
          if (profile.verificationStatus !== "VERIFIED" || profile.suspendedAt || profile.kycTier !== "FULL" || !profile.isOnline || !profile.isAvailable) {
            throw new ForbiddenError("A verified, online and available driver profile is required.");
          }
          if (offer.fixedPayoutMinor != null) {
            throw conflict("FIXED_PAYOUT_ACCEPTANCE_REQUIRED", "This offer has a platform-fixed payout and cannot receive a fare proposal.");
          }
          if (offer.status !== "OFFERED" || offer.proposedFareMinor != null
            || offer.expiresAt <= now || offer.deliveryLeg.status !== "READY_FOR_ASSIGNMENT") {
            throw conflict("OFFER_NO_LONGER_AVAILABLE", "This delivery-leg offer is no longer available for a fare proposal.");
          }
          const capability = parcelCapabilityForLegType(offer.deliveryLeg.type);
          const driverGrant = capability && await tx.driverCapabilityGrant.findFirst({
            where: { driverProfileId: profile.id, capability, status: "APPROVED" },
            select: { id: true },
          });
          if (!driverGrant) throw conflict("DRIVER_CAPABILITY_NOT_APPROVED", "Your capability for this delivery service is not approved.");
          const vehicleWhere = eligibleVehicleWhere({ driverProfileId: profile.id, capability, now, strictMode: env.DRIVER_KYC_MODE === "STRICT" });
          const eligibleVehicles = vehicleId
            ? await tx.vehicle.findMany({ where: { id: vehicleId, ...vehicleWhere }, select: { id: true }, take: 2 })
            : await tx.vehicle.findMany({ where: vehicleWhere, select: { id: true }, take: 2 });
          if (!eligibleVehicles.length) throw conflict("VEHICLE_NOT_ELIGIBLE", "Select one of your active, verified vehicles before proposing a fare.");
          if (eligibleVehicles.length > 1) throw conflict("VEHICLE_SELECTION_REQUIRED", "Select the vehicle you will use for this delivery.");
          const vehicle = eligibleVehicles[0];
          const updated = await db.updateOffer(tx, {
            id: offer.id, driverProfileId: profile.id, status: "OFFERED",
            proposedFareMinor: null, expiresAt: { gt: now },
          }, {
            vehicleId: vehicle.id,
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
            metadata: { deliveryLegId: offer.deliveryLegId, offerId, vehicleId: vehicle.id, proposedFareMinor: fare.toString(), currency: offer.currency },
          });
          return { offerId, vehicleId: vehicle.id, proposedFareMinor: fare.toString(), currency: offer.currency, status: "OFFERED" };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await db.findOfferByProposalKey(idempotencyKey);
        if (!existing || existing.id !== offerId || existing.proposalPayloadHash !== proposalHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different fare proposal.");
        }
        return { offerId, vehicleId: existing.vehicleId, proposedFareMinor: existing.proposedFareMinor.toString(), currency: existing.currency, status: existing.status, replay: true };
      }
    },

    async acceptFixedPayout({ offerId, userId, vehicleId, idempotencyKey }) {
      const now = clock();
      const payloadHash = hash({ offerId, vehicleId, userId });
      const prior = await db.findOfferByAcceptanceKey(idempotencyKey);
      if (prior) {
        const callerProfile = await db.findDriverProfile(userId);
        if (!callerProfile || prior.driverProfileId !== callerProfile.id) {
          throw new NotFoundError("Delivery-leg offer not found.");
        }
        if (prior.id !== offerId || prior.acceptancePayloadHash !== payloadHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used for a different fixed-payout acceptance.");
        }
        const assignment = await prismaClient.driverAssignment.findFirst({
          where: { deliveryLegId: prior.deliveryLegId, driverProfileId: prior.driverProfileId },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, agreedFareMinor: true },
        });
        return {
          offerId, assignmentId: assignment?.id ?? null, status: assignment?.status ?? "ACCEPTED",
          fixedPayoutMinor: assignment?.agreedFareMinor?.toString() ?? prior.fixedPayoutMinor.toString(),
          currency: prior.currency, replay: true,
        };
      }

      try {
        return await db.acceptOfferTransaction(async (tx) => {
          const profile = await tx.driverProfile.findUnique({
            where: { userId },
            select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true },
          });
          if (!profile || profile.verificationStatus !== "VERIFIED" || profile.kycTier !== "FULL"
            || profile.suspendedAt || !profile.isOnline || !profile.isAvailable) {
            throw new ForbiddenError("A verified, online and available driver profile is required.");
          }

          const offer = await tx.deliveryLegOffer.findUnique({
            where: { id: offerId },
            include: { deliveryLeg: { include: { parcelBooking: true } } },
          });
          if (!offer || offer.driverProfileId !== profile.id) throw new NotFoundError("Delivery-leg offer not found.");
          if (offer.acceptanceIdempotencyKey === idempotencyKey) {
            if (offer.acceptancePayloadHash !== payloadHash) throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used for a different fixed-payout acceptance.");
            const assignment = await tx.driverAssignment.findFirst({
              where: { deliveryLegId: offer.deliveryLegId, driverProfileId: profile.id },
              orderBy: { createdAt: "desc" }, select: { id: true, status: true, agreedFareMinor: true },
            });
            return { offerId, assignmentId: assignment?.id ?? null, status: assignment?.status ?? "ACCEPTED",
              fixedPayoutMinor: assignment?.agreedFareMinor?.toString() ?? offer.fixedPayoutMinor.toString(),
              currency: offer.currency, replay: true };
          }

          const leg = offer.deliveryLeg;
          const booking = leg.parcelBooking;
          const payout = offer.fixedPayoutMinor;
          const integrationShipment = booking.integrationClientId != null && booking.senderId == null;
          const customerShipment = booking.senderId != null && booking.integrationClientId == null;
          const customerPaymentReady = customerShipment
            && ["INITIALIZED", "FAILED"].includes(booking.paymentStatus)
            && booking.status === "AWAITING_PARTNER_ASSIGNMENT"
            && booking.pricingSnapshot?.source === "PLATFORM_ROUTE_RATE"
            && booking.pricingSnapshot?.quoteId === leg.metadata?.quoteId;
          const integrationPaymentReady = integrationShipment
            && booking.integrationDispatchAuthorizedAt != null
            && booking.paymentStatus === "SUCCEEDED"
            && booking.status === "AWAITING_PARTNER_ASSIGNMENT";
          if (offer.status !== "OFFERED" || offer.expiresAt <= now || payout == null || payout <= 0n
            || offer.proposedFareMinor != null || leg.status !== "READY_FOR_ASSIGNMENT"
            || leg.type !== "LOCAL_PICKUP" || leg.metadata?.pricingSource !== "PLATFORM_ROUTE_RATE"
            || leg.metadata?.driverPayoutMinor !== payout.toString()
            || booking.pricingSnapshot?.driverPayoutMinor !== payout.toString()
            || !(customerPaymentReady || integrationPaymentReady)) {
            throw conflict("FIXED_PAYOUT_OFFER_UNAVAILABLE", "This fixed-payout offer is no longer authorized or available.");
          }

          await tx.$queryRaw`SELECT "id" FROM "driver_profiles" WHERE "id" = ${profile.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "delivery_legs" WHERE "id" = ${leg.id} FOR UPDATE`;
          const lockedLeg = await tx.deliveryLeg.findUnique({
            where: { id: leg.id }, include: { parcelBooking: true },
          });
          const lockedBooking = lockedLeg?.parcelBooking;
          const lockedCustomerShipment = lockedBooking?.senderId != null && lockedBooking?.integrationClientId == null
            && lockedBooking.status === "AWAITING_PARTNER_ASSIGNMENT"
            && ["INITIALIZED", "FAILED"].includes(lockedBooking.paymentStatus)
            && lockedBooking.pricingSnapshot?.source === "PLATFORM_ROUTE_RATE"
            && lockedBooking.pricingSnapshot?.quoteId === lockedLeg.metadata?.quoteId;
          const lockedIntegrationShipment = lockedBooking?.integrationClientId != null && lockedBooking?.senderId == null
            && lockedBooking.integrationDispatchAuthorizedAt != null
            && lockedBooking.paymentStatus === "SUCCEEDED"
            && lockedBooking.status === "AWAITING_PARTNER_ASSIGNMENT";
          if (!lockedLeg || lockedLeg.status !== "READY_FOR_ASSIGNMENT"
            || lockedLeg.metadata?.pricingSource !== "PLATFORM_ROUTE_RATE"
            || lockedLeg.metadata?.driverPayoutMinor !== payout.toString()
            || lockedBooking?.pricingSnapshot?.driverPayoutMinor !== payout.toString()
            || !(lockedCustomerShipment || lockedIntegrationShipment)) {
            throw conflict("FIXED_PAYOUT_OFFER_UNAVAILABLE", "The shipment is no longer eligible for fixed-payout driver assignment.");
          }

          const routeAvailability = await tx.platformRouteAvailability.findFirst({
            where: {
              originServiceZoneId: leg.originServiceZoneId,
              destinationServiceZoneId: leg.destinationServiceZoneId,
              serviceType: "PARCEL_DELIVERY", isEnabled: true,
              AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
              ],
            },
            select: { id: true },
          });
          if (!routeAvailability) throw conflict("PLATFORM_ROUTE_UNAVAILABLE", "The platform-operated route is no longer enabled.");

          const capability = parcelCapabilityForLegType(leg.type);
          const vehicle = await tx.vehicle.findFirst({
            where: { id: vehicleId, ...eligibleVehicleWhere({
              driverProfileId: profile.id, capability, now, strictMode: env.DRIVER_KYC_MODE === "STRICT",
            }) },
            select: { id: true },
          });
          if (!vehicle) throw conflict("VEHICLE_NOT_ELIGIBLE", "Select an active, verified vehicle approved for this delivery service.");
          const grant = await tx.driverCapabilityGrant.findFirst({
            where: { driverProfileId: profile.id, capability, status: "APPROVED" }, select: { id: true },
          });
          if (!grant) throw conflict("DRIVER_CAPABILITY_NOT_APPROVED", "Your capability for this delivery service is not approved.");

          const driver = await tx.driverProfile.findFirst({
            where: {
              id: profile.id, verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null,
              isOnline: true, isAvailable: true,
              lastLocationAt: { gte: new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000), lte: now },
            },
            select: {
              id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true,
              serviceRadiusMeters: true, lastLocationAt: true,
              locations: { orderBy: { recordedAt: "desc" }, take: 1, select: { latitude: true, longitude: true, recordedAt: true } },
            },
          });
          if (!assertEligibleDriver(driver, leg, now)) throw conflict("DRIVER_NO_LONGER_AVAILABLE", "Your current location is no longer eligible for this pickup.");
          const activeZones = await db.findActiveServiceZones(tx, leg, now);
          const requiredZoneCount = new Set([leg.originServiceZoneId, leg.destinationServiceZoneId]).size;
          if (activeZones.length !== requiredZoneCount) throw conflict("SERVICE_ZONE_UNAVAILABLE", "The origin or destination zone is no longer active.");

          const reserved = await tx.driverProfile.updateMany({
            where: {
              id: profile.id, verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null,
              isOnline: true, isAvailable: true,
              lastLocationAt: { gte: new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000), lte: now },
              user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
              ...activeDriverCapabilityWhere(capability),
              ...activeDriverDocumentWhere(now, env.DRIVER_KYC_MODE === "STRICT"),
              vehicles: { some: { id: vehicle.id, ...eligibleVehicleWhere({ capability, now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }) } },
              AND: [
                { coverage: { some: { serviceZoneId: leg.originServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true, serviceZone: { is: activeServiceZoneWhere(now) } } } },
                { coverage: { some: { serviceZoneId: leg.destinationServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true, serviceZone: { is: activeServiceZoneWhere(now) } } } },
              ],
              assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
            },
            data: { isAvailable: false },
          });
          if (reserved.count !== 1) throw conflict("DRIVER_NO_LONGER_AVAILABLE", "This driver is no longer available for assignment.");

          const accepted = await tx.deliveryLegOffer.updateMany({
            where: { id: offer.id, driverProfileId: profile.id, status: "OFFERED", fixedPayoutMinor: payout, expiresAt: { gt: now } },
            data: {
              status: "ACCEPTED", vehicleId: vehicle.id, respondedAt: now,
              acceptanceIdempotencyKey: idempotencyKey, acceptancePayloadHash: payloadHash,
            },
          });
          if (accepted.count !== 1) throw conflict("FIXED_PAYOUT_OFFER_UNAVAILABLE", "This fixed-payout offer was accepted by another process.");
          await tx.deliveryLegOffer.updateMany({
            where: { deliveryLegId: leg.id, id: { not: offer.id }, status: "OFFERED" },
            data: { status: "WITHDRAWN", respondedAt: now },
          });
          const customerPaymentFlow = lockedCustomerShipment;
          const nextLegStatus = customerPaymentFlow ? "AWAITING_PAYMENT" : "ASSIGNED";
          const nextBookingStatus = customerPaymentFlow ? "AWAITING_PAYMENT" : "DRIVER_ASSIGNED";
          const legChanged = await tx.deliveryLeg.updateMany({
            where: { id: leg.id, status: "READY_FOR_ASSIGNMENT" },
            data: { status: nextLegStatus, ...(customerPaymentFlow ? {} : { assignedAt: now }) },
          });
          if (legChanged.count !== 1) throw conflict("DELIVERY_LEG_STATE_CONFLICT", "The delivery leg changed during driver acceptance.");
          const bookingChanged = await tx.parcelBooking.updateMany({
            where: {
              id: booking.id, status: "AWAITING_PARTNER_ASSIGNMENT",
              ...(customerPaymentFlow
                ? { paymentStatus: { in: ["INITIALIZED", "FAILED"] }, senderId: { not: null }, integrationClientId: null }
                : { paymentStatus: "SUCCEEDED", integrationDispatchAuthorizedAt: { not: null }, integrationClientId: { not: null } }),
            },
            data: { status: nextBookingStatus },
          });
          if (bookingChanged.count !== 1) throw conflict("SHIPMENT_STATE_CONFLICT", "The shipment changed during driver acceptance.");

          const paymentExpiresAt = customerPaymentFlow ? new Date(now.getTime() + 15 * 60_000) : null;
          const assignment = await tx.driverAssignment.create({
            data: {
              parcelBookingId: booking.id, deliveryLegId: leg.id, driverProfileId: profile.id,
              vehicleId: vehicle.id, assignedByUserId: userId,
              status: customerPaymentFlow ? "AWAITING_PAYMENT" : "ACCEPTED",
              agreedFareMinor: payout, currency: offer.currency, reservedAt: now,
              ...(customerPaymentFlow ? { paymentExpiresAt } : { acceptedAt: now }),
            },
            select: { id: true },
          });
          const sourceEvent = await tx.bookingEvent.create({
            data: {
              parcelBookingId: booking.id, actorUserId: userId,
              eventType: customerPaymentFlow ? "PLATFORM_FIXED_PAYOUT_DRIVER_RESERVED" : "PLATFORM_FIXED_PAYOUT_DRIVER_ACCEPTED",
              fromStatus: "AWAITING_PARTNER_ASSIGNMENT", toStatus: nextBookingStatus,
              metadata: {
                deliveryLegId: leg.id, offerId, assignmentId: assignment.id, driverProfileId: profile.id,
                vehicleId: vehicle.id, fixedPayoutMinor: payout.toString(), currency: offer.currency,
                pricingSource: "PLATFORM_ROUTE_RATE",
                ...(customerPaymentFlow ? { paymentRequired: true, paymentExpiresAt: paymentExpiresAt.toISOString() } : {}),
              },
            },
          });
          await projectIntegrationShipmentEvent({ tx, parcelBookingId: booking.id, sourceEvent });
          return { offerId, assignmentId: assignment.id, status: customerPaymentFlow ? "AWAITING_PAYMENT" : "ACCEPTED",
            fixedPayoutMinor: payout.toString(), currency: offer.currency,
            ...(customerPaymentFlow ? { paymentRequired: true, paymentExpiresAt } : {}), replay: false };
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const existing = await db.findOfferByAcceptanceKey(idempotencyKey);
        const callerProfile = await db.findDriverProfile(userId);
        if (!callerProfile || existing?.driverProfileId !== callerProfile.id
          || !existing || existing.id !== offerId || existing.acceptancePayloadHash !== payloadHash) {
          throw conflict("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used for a different fixed-payout acceptance.");
        }
        const assignment = await prismaClient.driverAssignment.findFirst({
          where: { deliveryLegId: existing.deliveryLegId, driverProfileId: existing.driverProfileId },
          orderBy: { createdAt: "desc" }, select: { id: true, status: true, agreedFareMinor: true },
        });
        return { offerId, assignmentId: assignment?.id ?? null, status: assignment?.status ?? "ACCEPTED",
          fixedPayoutMinor: assignment?.agreedFareMinor?.toString() ?? existing.fixedPayoutMinor.toString(),
          currency: existing.currency, replay: true };
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
      const bookingAccess = await prismaClient.parcelBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, senderId: true },
      });
      if (!bookingAccess) throw new NotFoundError("Parcel booking not found.");
      if (bookingAccess.senderId !== user.id) throw new ForbiddenError();
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
          status: priorAcceptance.deliveryLeg.status,
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
          if (!offer.vehicleId) throw conflict("VEHICLE_NOT_SELECTED", "The driver has not selected a vehicle for this offer.");
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
          const capability = parcelCapabilityForLegType(leg.type);
          const selectedVehicle = await tx.vehicle.findFirst({
            where: { id: offer.vehicleId, ...eligibleVehicleWhere({ driverProfileId: offer.driverProfileId, capability, now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }) },
            select: { id: true },
          });
          if (!selectedVehicle) throw conflict("VEHICLE_NO_LONGER_ELIGIBLE", "The selected vehicle is no longer approved for this delivery service.");
          const driverGrant = await tx.driverCapabilityGrant.findFirst({
            where: { driverProfileId: offer.driverProfileId, capability, status: "APPROVED" },
            select: { id: true },
          });
          if (!driverGrant) throw conflict("DRIVER_CAPABILITY_NO_LONGER_APPROVED", "The selected driver is no longer approved for this delivery service.");
          const activeZones = await db.findActiveServiceZones(tx, leg, now);
          const requiredZoneCount = new Set([leg.originServiceZoneId, leg.destinationServiceZoneId]).size;
          if (activeZones.length !== requiredZoneCount) throw conflict("SERVICE_ZONE_UNAVAILABLE", "The origin or destination zone is no longer active and available.");
          const driverSnapshot = await tx.driverProfile.findFirst({
            where: {
              id: offer.driverProfileId,
              verificationStatus: "VERIFIED",
              isOnline: true,
              isAvailable: true,
              lastLocationAt: { gte: new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000), lte: now },
            },
            select: {
              id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true, isAvailable: true,
              serviceRadiusMeters: true, lastLocationAt: true,
              locations: {
                orderBy: { recordedAt: "desc" }, take: 1,
                select: { latitude: true, longitude: true, recordedAt: true },
              },
            },
          });
          if (!assertEligibleDriver(driverSnapshot, leg, now)) {
            throw conflict("DRIVER_NO_LONGER_AVAILABLE", "The selected driver is no longer within the required pickup radius.");
          }
          const driverReserved = await tx.driverProfile.updateMany({
            where: {
              id: offer.driverProfileId,
              verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true,
              lastLocationAt: { gte: new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000), lte: now },
              user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
              ...activeDriverCapabilityWhere(capability),
              ...activeDriverDocumentWhere(now, env.DRIVER_KYC_MODE === "STRICT"),
              vehicles: { some: { id: offer.vehicleId, ...eligibleVehicleWhere({ capability, now, strictMode: env.DRIVER_KYC_MODE === "STRICT" }) } },
              AND: [
                { coverage: { some: { serviceZoneId: leg.originServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true, serviceZone: { is: activeServiceZoneWhere(now) } } } },
                { coverage: { some: { serviceZoneId: leg.destinationServiceZoneId, serviceType: "PARCEL_DELIVERY", isEnabled: true, serviceZone: { is: activeServiceZoneWhere(now) } } } },
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
              vehicleId: offer.vehicleId,
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
                deliveryLegId: leg.id, assignmentId: assignment.id, offerId, vehicleId: offer.vehicleId,
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
          status: existing.deliveryLeg?.status ?? "AWAITING_PAYMENT",
          agreedFareMinor: assignment?.agreedFareMinor?.toString() ?? existing.proposedFareMinor.toString(),
          currency: existing.currency, paymentRequired: true, paymentEnabled: false, replay: true,
        };
      }
    },
  };
}

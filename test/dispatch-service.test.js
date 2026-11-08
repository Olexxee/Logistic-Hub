import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  createDispatchService,
  distanceBetweenCoordinatesMeters,
  isDriverWithinPickupRadius,
} from "../src/modules/dispatch/dispatch.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");

function driver(id, { latitude = 6.5244, longitude = 3.3792, radius = 5000, recordedAt = now, lastLocationAt = now } = {}) {
  return {
    id,
    serviceRadiusMeters: radius,
    lastLocationAt,
    locations: [{ latitude, longitude, recordedAt }],
  };
}

test("Haversine distance uses geographic coordinates in metres", () => {
  const distance = distanceBetweenCoordinatesMeters(0, 0, 0, 1);
  assert.ok(distance > 111_000 && distance < 112_000);
});

test("driver pickup eligibility requires a fresh location inside the configured service radius", () => {
  const pickup = { latitude: 6.5244, longitude: 3.3792 };
  assert.equal(isDriverWithinPickupRadius(driver("nearby"), pickup, now), true);
  assert.equal(isDriverWithinPickupRadius(driver("far", { latitude: 6.7, longitude: 3.6 }), pickup, now), false);
  assert.equal(isDriverWithinPickupRadius(driver("stale", {
    recordedAt: new Date(now.getTime() - 6 * 60_000),
    lastLocationAt: new Date(now.getTime() - 6 * 60_000),
  }), pickup, now), false);
  assert.equal(isDriverWithinPickupRadius(driver("future-profile-time", {
    lastLocationAt: new Date(now.getTime() + 60_000),
  }), pickup, now), false);
  assert.equal(isDriverWithinPickupRadius(driver("future-record-time", {
    recordedAt: new Date(now.getTime() + 60_000),
  }), pickup, now), false);
  assert.equal(isDriverWithinPickupRadius({ id: "missing", serviceRadiusMeters: 5000, lastLocationAt: now, locations: [] }, pickup, now), false);
});

test("parcel matching creates offers only for fresh, nearby eligible drivers", async () => {
  const createdOffers = [];
  let driverQuery;
  let zoneQuery;
  const booking = {
    id: "booking_1",
    senderId: "sender_1",
    status: "DRAFT",
    currency: "NGN",
    pickupServiceZoneId: "zone_pickup",
    destinationServiceZoneId: "zone_destination",
    pickupLatitude: 6.5244,
    pickupLongitude: 3.3792,
  };
  const prismaClient = {
    $transaction: (callback) => callback({
      parcelBooking: {
        findUnique: async () => booking,
        updateMany: async () => ({ count: 1 }),
      },
      serviceZone: {
        findMany: async (query) => { zoneQuery = query; return [{ id: "zone_pickup", stateId: "lagos" }, { id: "zone_destination", stateId: "lagos" }]; },
      },
      driverProfile: {
        findMany: async (query) => {
          driverQuery = query;
          return [
            driver("nearby"),
            driver("outside-radius", { latitude: 6.7, longitude: 3.6 }),
            driver("stale", {
              recordedAt: new Date(now.getTime() - 6 * 60_000),
              lastLocationAt: new Date(now.getTime() - 6 * 60_000),
            }),
          ];
        },
      },
      driverOffer: {
        createMany: async ({ data }) => {
          createdOffers.push(...data);
          return { count: data.length };
        },
      },
      bookingEvent: { create: async () => ({ id: "event_1" }) },
    }),
  };
  const service = createDispatchService({ prismaClient, clock: () => now });
  const result = await service.requestParcelMatching({
    bookingId: booking.id,
    user: { id: "sender_1", role: "CUSTOMER" },
  });

  assert.deepEqual(createdOffers.map((offer) => offer.driverProfileId), ["nearby"]);
  assert.equal(result.offersCreated, 1);
  assert.deepEqual(zoneQuery.where.id.in, ["zone_pickup", "zone_destination"]);
  assert.deepEqual(zoneQuery.select, { id: true, stateId: true });
  assert.deepEqual(driverQuery.where.kycTier.in, ["FULL", "TEST_LIMITED"]);
  assert.equal(driverQuery.where.suspendedAt, null);
  assert.equal(zoneQuery.where.availability.some.serviceType, "PARCEL_DELIVERY");
  assert.equal(zoneQuery.where.availability.some.isEnabled, true);
  assert.deepEqual(driverQuery.where.lastLocationAt, {
    gte: new Date(now.getTime() - 5 * 60_000),
    lte: now,
  });
  assert.deepEqual(driverQuery.select.locations, {
    orderBy: { recordedAt: "desc" },
    take: 1,
    select: { latitude: true, longitude: true, recordedAt: true },
  });
});

test("cross-state parcel routes cannot enter direct local-driver matching", async () => {
  const booking = {
    id: "booking_cross_state",
    senderId: "sender_cross_state",
    status: "DRAFT",
    currency: "NGN",
    pickupServiceZoneId: "lagos_zone",
    destinationServiceZoneId: "ogun_zone",
    pickupLatitude: 6.5244,
    pickupLongitude: 3.3792,
  };
  const prismaClient = {
    $transaction: (callback) => callback({
      parcelBooking: { findUnique: async () => booking },
      serviceZone: {
        findMany: async () => [
          { id: "lagos_zone", stateId: "NG-LA" },
          { id: "ogun_zone", stateId: "NG-OG" },
        ],
      },
      driverProfile: { findMany: async () => { throw new Error("Driver matching must not run for cross-state routes."); } },
    }),
  };
  const service = createDispatchService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.requestParcelMatching({ bookingId: booking.id, user: { id: booking.senderId, role: "CUSTOMER" } }),
    (error) => error.code === "PARTNER_QUOTE_REQUIRED" && error.statusCode === 409,
  );
});

test("driver offer cards expose service-zone names, not precise pickup or destination addresses", async () => {
  let offerQuery;
  const prismaClient = {
    driverProfile: {
      findUnique: async () => ({
        id: "driver_profile_1",
        verificationStatus: "VERIFIED",
        kycTier: "FULL",
        suspendedAt: null,
        isOnline: true,
        isAvailable: true,
      }),
    },
    driverOffer: {
      findMany: async (query) => {
        offerQuery = query;
        return [{
          id: "offer_1",
          currency: "NGN",
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          parcelBooking: {
            id: "booking_1",
            publicReference: "LH-PCL-123",
            currency: "NGN",
            parcelCategory: "DOCUMENTS",
            parcelSize: "SMALL",
            pickupServiceZone: { name: "Ikeja" },
            destinationServiceZone: { name: "Surulere" },
          },
        }];
      },
    },
  };
  const service = createDispatchService({ prismaClient, clock: () => now });
  const offers = await service.listDriverOffers({ userId: "driver_user_1" });

  const selection = offerQuery.include.parcelBooking.select;
  assert.equal("pickupAddress" in selection, false);
  assert.equal("destinationAddress" in selection, false);
  assert.equal("recipientName" in selection, false);
  assert.equal("recipientPhone" in selection, false);
  assert.equal("pickupLatitude" in selection, false);
  assert.equal("destinationLatitude" in selection, false);
  assert.deepEqual(selection.pickupServiceZone, { select: { name: true } });
  assert.deepEqual(selection.destinationServiceZone, { select: { name: true } });
  assert.equal(offers[0].booking.pickupServiceZone.name, "Ikeja");
  assert.equal(offers[0].booking.destinationServiceZone.name, "Surulere");
});


test("customer fare acceptance locks the agreed price and creates a temporary assignment atomically", async () => {
  const writes = [];
  const booking = {
    id: "booking_2",
    senderId: "sender_2",
    status: "MATCHING",
    pickupServiceZoneId: "zone_pickup",
    destinationServiceZoneId: "zone_destination",
    connectionFeeMinor: 300n,
    otherChargesMinor: 50n,
    currency: "NGN",
    pricingSnapshot: { minimumDriverFareMinor: "1000" },
  };
  const offer = {
    id: "offer_2",
    parcelBookingId: booking.id,
    driverProfileId: "driver_profile_2",
    vehicleId: "vehicle_2",
    status: "OFFERED",
    proposedFareMinor: 2500n,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  const tx = {
    parcelBooking: {
      findUnique: async () => booking,
      updateMany: async (args) => { writes.push(["booking", args]); return { count: 1 }; },
    },
    driverOffer: {
      findUnique: async () => offer,
      updateMany: async (args) => { writes.push(["offer", args]); return { count: 1 }; },
    },
    driverProfile: {
      updateMany: async (args) => { writes.push(["driver", args]); return { count: 1 }; },
    },
    vehicle: { findFirst: async () => ({ id: "vehicle_2" }) },
    deliveryLeg: {
      create: async (args) => { writes.push(["deliveryLeg", args]); return { id: "delivery_leg_2" }; },
    },
    driverAssignment: {
      create: async (args) => { writes.push(["assignment", args]); return { id: "assignment_2" }; },
    },
    bookingEvent: {
      create: async (args) => { writes.push(["event", args]); return { id: "event_2" }; },
    },
  };
  const service = createDispatchService({
    prismaClient: { $transaction: async (callback) => callback(tx) },
    clock: () => now,
  });
  const result = await service.acceptParcelFare({
    bookingId: booking.id,
    user: { id: "sender_2", role: "CUSTOMER" },
    offerId: offer.id,
    idempotencyKey: "fare-acceptance-0002",
  });

  assert.equal(result.status, "AWAITING_PAYMENT");
  assert.equal(result.assignmentId, "assignment_2");
  assert.equal(result.driverFareMinor, "2500");
  assert.equal(result.connectionFeeMinor, "300");
  assert.equal(result.otherChargesMinor, "50");
  assert.equal(result.customerPayableMinor, "2850");
  assert.equal(result.paymentExpiresAt.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString());
  assert.equal(writes.find(([kind]) => kind === "driver")[1].data.isAvailable, false);
  assert.equal(writes.find(([kind]) => kind === "booking")[1].data.status, "AWAITING_PAYMENT");
  assert.equal(writes.find(([kind]) => kind === "deliveryLeg")[1].data.sequence, 1);
  assert.equal(writes.find(([kind]) => kind === "deliveryLeg")[1].data.type, "DIRECT");
  assert.equal(writes.find(([kind]) => kind === "deliveryLeg")[1].data.status, "AWAITING_PAYMENT");
  assert.equal(writes.find(([kind]) => kind === "assignment")[1].data.deliveryLegId, "delivery_leg_2");
  assert.equal(writes.find(([kind]) => kind === "assignment")[1].data.vehicleId, "vehicle_2");
  assert.equal(result.deliveryLegId, "delivery_leg_2");
  assert.equal(writes.find(([kind]) => kind === "assignment")[1].data.agreedFareMinor, 2500n);
  assert.equal(writes.find(([kind]) => kind === "assignment")[1].data.status, "AWAITING_PAYMENT");
  assert.equal(writes.find(([kind]) => kind === "event")[1].data.metadata.deliveryLegId, "delivery_leg_2");
  assert.equal(writes.find(([kind]) => kind === "event")[1].data.eventType, "DRIVER_FARE_ACCEPTED");
});

test("driver fare proposal requires an owned active verified vehicle and stores it on the offer", async () => {
  let offerUpdate;
  let event;
  const offer = {
    id: "offer_vehicle_1",
    parcelBookingId: "booking_vehicle_1",
    driverProfileId: "driver_profile_vehicle_1",
    status: "OFFERED",
    proposedFareMinor: null,
    expiresAt: new Date(now.getTime() + 60_000),
    parcelBooking: { id: "booking_vehicle_1", status: "MATCHING", pricingSnapshot: { minimumDriverFareMinor: "1000" } },
  };
  const tx = {
    driverProfile: { findUnique: async () => ({ id: "driver_profile_vehicle_1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }) },
    driverOffer: {
      findUnique: async () => offer,
      updateMany: async ({ data }) => { offerUpdate = data; return { count: 1 }; },
    },
    vehicle: { findMany: async () => [{ id: "vehicle-verified" }] },
    bookingEvent: { create: async ({ data }) => { event = data; return data; } },
  };
  const service = createDispatchService({ prismaClient: { $transaction: callback => callback(tx) }, clock: () => now });
  const result = await service.proposeParcelFare({
    offerId: offer.id,
    userId: "driver-user",
    proposedFareMinor: "2500",
    idempotencyKey: "parcel-fare-with-vehicle-0001",
  });
  assert.equal(result.vehicleId, "vehicle-verified");
  assert.equal(offerUpdate.vehicleId, "vehicle-verified");
  assert.equal(event.metadata.vehicleId, "vehicle-verified");
});

test("legacy fare proposal without vehicleId is rejected when multiple verified vehicles are active", async () => {
  const offer = {
    id: "offer_multi_vehicle",
    parcelBookingId: "booking_multi_vehicle",
    driverProfileId: "driver_profile_multi",
    status: "OFFERED",
    proposedFareMinor: null,
    expiresAt: new Date(now.getTime() + 60_000),
    parcelBooking: { id: "booking_multi_vehicle", status: "MATCHING", pricingSnapshot: { minimumDriverFareMinor: "1000" } },
  };
  let offerWasUpdated = false;
  const tx = {
    driverProfile: { findUnique: async () => ({ id: "driver_profile_multi", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }) },
    driverOffer: { findUnique: async () => offer, updateMany: async () => { offerWasUpdated = true; return { count: 1 }; } },
    vehicle: { findMany: async () => [{ id: "vehicle-1" }, { id: "vehicle-2" }] },
  };
  const service = createDispatchService({ prismaClient: { $transaction: callback => callback(tx) }, clock: () => now });
  await assert.rejects(
    service.proposeParcelFare({ offerId: offer.id, userId: "driver-user", proposedFareMinor: "2500", idempotencyKey: "multi-vehicle-fare-0001" }),
    error => error.code === "VEHICLE_SELECTION_REQUIRED" && error.statusCode === 409,
  );
  assert.equal(offerWasUpdated, false);
});

test("fare proposal idempotency collisions across offers return a conflict instead of a database error", async () => {
  const key = "shared-fare-key-0001";
  const proposedFareMinor = "2500";
  const vehicleId = "vehicle_1";
  const hash = createHash("sha256").update(JSON.stringify({ offerId: "another_offer", vehicleId, proposedFareMinor })).digest("hex");
  const prismaClient = {
    $transaction: async () => { throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); },
    driverOffer: {
      findUnique: async () => ({
        id: "another_offer",
        proposedFareMinor: 2500n,
        currency: "NGN",
        status: "OFFERED",
        fareProposalPayloadHash: hash,
      }),
    },
  };
  const service = createDispatchService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.proposeParcelFare({
      offerId: "offer_requested",
      userId: "driver_user",
      vehicleId,
      proposedFareMinor,
      idempotencyKey: key,
    }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.statusCode === 409,
  );
});

test("fare acceptance idempotency collisions across bookings return a conflict", async () => {
  const key = "shared-accept-key-0001";
  const bookingId = "another_booking";
  const offerId = "another_offer";
  const hash = createHash("sha256").update(JSON.stringify({ bookingId, offerId })).digest("hex");
  const prismaClient = {
    $transaction: async () => { throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); },
    parcelBooking: {
      findUnique: async () => ({
        id: bookingId,
        fareAcceptancePayloadHash: hash,
        status: "AWAITING_PAYMENT",
        driverFareMinor: 2000n,
        connectionFeeMinor: 300n,
        otherChargesMinor: 0n,
        customerPayableMinor: 2300n,
        currency: "NGN",
      }),
    },
    driverAssignment: { findFirst: async () => ({ id: "existing_assignment", paymentExpiresAt: now }) },
  };
  const service = createDispatchService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.acceptParcelFare({
      bookingId: "requested_booking",
      user: { id: "sender", role: "CUSTOMER" },
      offerId: "requested_offer",
      idempotencyKey: key,
    }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.statusCode === 409,
  );
});

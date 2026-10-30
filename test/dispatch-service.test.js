import test from "node:test";
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
  assert.equal(isDriverWithinPickupRadius({ id: "missing", serviceRadiusMeters: 5000, lastLocationAt: now, locations: [] }, pickup, now), false);
});

test("parcel matching creates offers only for fresh, nearby eligible drivers", async () => {
  const createdOffers = [];
  let driverQuery;
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
  assert.deepEqual(driverQuery.where.lastLocationAt, {
    gte: new Date(now.getTime() - 5 * 60_000),
  });
  assert.deepEqual(driverQuery.select.locations, {
    orderBy: { recordedAt: "desc" },
    take: 1,
    select: { latitude: true, longitude: true, recordedAt: true },
  });
});

test("driver offer cards expose service-zone names, not precise pickup or destination addresses", async () => {
  let offerQuery;
  const prismaClient = {
    driverProfile: {
      findUnique: async () => ({
        id: "driver_profile_1",
        verificationStatus: "VERIFIED",
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

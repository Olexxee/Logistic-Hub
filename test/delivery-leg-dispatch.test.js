import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createDeliveryLegDispatchService } from "../src/modules/delivery-legs/delivery-leg-dispatch.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
const leg = {
  id: "leg_pickup",
  parcelBookingId: "booking_1",
  sequence: 1,
  type: "LOCAL_PICKUP",
  status: "READY_FOR_ASSIGNMENT",
  originServiceZoneId: "zone_ikeja",
  destinationServiceZoneId: "zone_ikeja",
  originLatitude: 6.6018,
  originLongitude: 3.3515,
  parcelBooking: {
    id: "booking_1", senderId: "sender_1", publicReference: "LH-PCL-1",
    status: "AWAITING_PAYMENT", currency: "NGN", parcelCategory: "DOCUMENTS", parcelSize: "SMALL",
  },
  originServiceZone: { id: "zone_ikeja", name: "Ikeja" },
  destinationServiceZone: { id: "zone_ikeja", name: "Ikeja" },
  originHubPoint: null,
  destinationHubPoint: { id: "hub_1", name: "Ikeja Hub" },
};

function validDriver(id = "driver_1") {
  return {
    id,
    serviceRadiusMeters: 5000,
    verificationStatus: "VERIFIED",
    isOnline: true,
    isAvailable: true,
    lastLocationAt: now,
    locations: [{ latitude: 6.602, longitude: 3.352, recordedAt: now }],
  };
}

test("matching creates offers only for fresh eligible drivers on a ready local leg", async () => {
  let createdOffers;
  let event;
  const repository = {
    transaction: (callback) => callback({}),
    findLeg: async () => leg,
    listActiveOffers: async () => [],
    findEligibleDrivers: async () => [
      validDriver("near_driver"),
      { ...validDriver("stale_driver"), lastLocationAt: new Date(now.getTime() - 6 * 60_000) },
      { ...validDriver("far_driver"), locations: [{ latitude: 7.5, longitude: 3.3, recordedAt: now }] },
    ],
    createOffers: async (_tx, data) => { createdOffers = data; return { count: data.length }; },
    recordEvent: async (_tx, data) => { event = data; },
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.requestOffers({ legId: leg.id, user: { id: "sender_1", role: "CUSTOMER" } });

  assert.equal(result.offersCreated, 1);
  assert.equal(createdOffers[0].driverProfileId, "near_driver");
  assert.equal(createdOffers[0].deliveryLegId, leg.id);
  assert.equal(event.eventType, "DELIVERY_LEG_MATCHING_REQUESTED");
});

test("interstate transport legs cannot be dispatched to local drivers", async () => {
  const repository = {
    transaction: (callback) => callback({}),
    findLeg: async () => ({ ...leg, type: "INTERSTATE_TRANSPORT" }),
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  await assert.rejects(
    service.requestOffers({ legId: leg.id, user: { id: "sender_1", role: "CUSTOMER" } }),
    (error) => error.code === "LEG_REQUIRES_PARTNER_EXECUTION" && error.statusCode === 409,
  );
});

test("driver offer cards contain zone and hub summaries but no precise addresses or coordinates", async () => {
  const repository = {
    findDriverProfile: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", isOnline: true, isAvailable: true }),
    findDriverOffers: async () => [{
      id: "offer_1", currency: "NGN", expiresAt: now, createdAt: now,
      deliveryLeg: {
        id: "leg_1", sequence: 1, type: "LOCAL_PICKUP",
        originServiceZone: { name: "Ikeja" },
        destinationServiceZone: { name: "Ikeja" },
        originHubPoint: null,
        destinationHubPoint: { name: "Ikeja Hub" },
        parcelBooking: { publicReference: "LH-PCL-1", parcelCategory: "DOCUMENTS", parcelSize: "SMALL" },
      },
    }],
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const [offer] = await service.listDriverOffers({ userId: "driver_user_1" });
  assert.equal(offer.deliveryLeg.origin.serviceZone, "Ikeja");
  assert.equal(offer.deliveryLeg.destination.hub, "Ikeja Hub");
  assert.equal("pickupAddress" in offer.deliveryLeg, false);
  assert.equal("destinationAddress" in offer.deliveryLeg, false);
  assert.equal("originLatitude" in offer.deliveryLeg, false);
});

test("driver fare proposals are idempotent and scoped to the driver's own leg offer", async () => {
  let offerUpdate;
  let event;
  const offer = {
    id: "offer_1", deliveryLegId: leg.id, driverProfileId: "profile_1",
    status: "OFFERED", proposedFareMinor: null, proposalIdempotencyKey: null,
    expiresAt: new Date(now.getTime() + 60_000), currency: "NGN",
    deliveryLeg: { ...leg, status: "READY_FOR_ASSIGNMENT" },
  };
  const repository = {
    transaction: (callback) => callback({
      driverProfile: { findUnique: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", isOnline: true, isAvailable: true }) },
    }),
    findOfferForDriver: async () => offer,
    updateOffer: async (_tx, where, data) => { offerUpdate = { where, data }; return { count: 1 }; },
    recordEvent: async (_tx, data) => { event = data; },
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.proposeFare({
    offerId: "offer_1", userId: "driver_user_1",
    proposedFareMinor: "2500", idempotencyKey: "leg-fare-proposal-0001",
  });
  assert.equal(result.proposedFareMinor, "2500");
  assert.equal(offerUpdate.data.proposalIdempotencyKey, "leg-fare-proposal-0001");
  assert.equal(event.eventType, "DELIVERY_LEG_FARE_PROPOSED");
});

test("customer acceptance reserves one driver and creates an awaiting-payment leg assignment", async () => {
  let assignment;
  let legUpdate;
  const offer = {
    id: "offer_1", deliveryLegId: leg.id, driverProfileId: "profile_1",
    status: "OFFERED", proposedFareMinor: 2500n, currency: "NGN",
    expiresAt: new Date(now.getTime() + 60_000),
  };
  const tx = {
    parcelBooking: { findUnique: async () => ({ id: "booking_1", senderId: "sender_1" }) },
    deliveryLeg: {
      findFirst: async () => ({ ...leg, status: "READY_FOR_ASSIGNMENT" }),
      updateMany: async (args) => { legUpdate = args; return { count: 1 }; },
    },
    deliveryLegOffer: {
      findUnique: async () => offer,
      updateMany: async () => ({ count: 1 }),
    },
    driverProfile: {
      findFirst: async () => validDriver("profile_1"),
      updateMany: async () => ({ count: 1 }),
    },
    driverAssignment: { create: async (args) => { assignment = args; return { id: "assignment_1" }; } },
    bookingEvent: { create: async () => ({}) },
  };
  const repository = {
    findOfferByAcceptanceKey: async () => null,
    acceptOfferTransaction: (callback) => callback(tx),
  };
  const service = createDeliveryLegDispatchService({
    prismaClient: {
      parcelBooking: { findUnique: async () => ({ id: "booking_1", senderId: "sender_1" }) },
      driverAssignment: { findFirst: async () => null },
    },
    repository,
    clock: () => now,
  });
  const result = await service.acceptFare({
    bookingId: "booking_1", legId: leg.id, offerId: "offer_1",
    user: { id: "sender_1", role: "CUSTOMER" },
    idempotencyKey: "leg-fare-acceptance-0001",
  });

  assert.equal(result.status, "AWAITING_PAYMENT");
  assert.equal(result.paymentEnabled, false);
  assert.equal(result.agreedFareMinor, "2500");
  assert.equal(assignment.data.deliveryLegId, leg.id);
  assert.equal(assignment.data.status, "AWAITING_PAYMENT");
  assert.equal(assignment.data.agreedFareMinor, 2500n);
  assert.deepEqual(legUpdate.where, { id: leg.id, status: "READY_FOR_ASSIGNMENT" });
  assert.deepEqual(legUpdate.data, { status: "AWAITING_PAYMENT" });
});


test("a hub operator with explicit dispatch delegation can request offers for a leg originating at their hub", async () => {
  let event;
  let createdOffers;
  const tx = {
    hubPoint: { findUnique: async () => ({ id: "hub_1", status: "ACTIVE" }) },
    hubPointOperator: {
      findUnique: async () => ({ hubPointId: "hub_1", userId: "hub_dispatcher_1", isActive: true, canDispatch: true }),
    },
  };
  const repository = {
    transaction: callback => callback(tx),
    findLeg: async () => ({ ...leg, originHubPointId: "hub_1", originHubPoint: { id: "hub_1", name: "Ikeja Hub" } }),
    listActiveOffers: async () => [],
    findEligibleDrivers: async () => [validDriver("hub_driver_1")],
    createOffers: async (_tx, data) => { createdOffers = data; return { count: data.length }; },
    recordEvent: async (_tx, data) => { event = data; },
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.requestOffers({
    legId: leg.id, hubPointId: "hub_1",
    user: { id: "hub_dispatcher_1", role: "CUSTOMER" },
  });
  assert.equal(result.offersCreated, 1);
  assert.equal(createdOffers[0].driverProfileId, "hub_driver_1");
  assert.equal(event.actorUserId, "hub_dispatcher_1");
});

test("a hub operator without explicit dispatch delegation cannot request driver offers", async () => {
  const tx = {
    hubPoint: { findUnique: async () => ({ id: "hub_1", status: "ACTIVE" }) },
    hubPointOperator: {
      findUnique: async () => ({ hubPointId: "hub_1", userId: "hub_operator_1", isActive: true, canDispatch: false }),
    },
  };
  const repository = {
    transaction: callback => callback(tx),
    findLeg: async () => ({ ...leg, originHubPointId: "hub_1", originHubPoint: { id: "hub_1", name: "Ikeja Hub" } }),
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  await assert.rejects(
    service.requestOffers({
      legId: leg.id, hubPointId: "hub_1",
      user: { id: "hub_operator_1", role: "CUSTOMER" },
    }),
    error => error.statusCode === 403,
  );
});

test("a delegated dispatcher cannot request offers for a leg originating at another hub", async () => {
  const tx = {
    hubPoint: { findUnique: async () => ({ id: "hub_1", status: "ACTIVE" }) },
    hubPointOperator: {
      findUnique: async () => ({ hubPointId: "hub_1", userId: "hub_dispatcher_1", isActive: true, canDispatch: true }),
    },
  };
  const repository = {
    transaction: callback => callback(tx),
    findLeg: async () => ({ ...leg, originHubPointId: "hub_other", originHubPoint: { id: "hub_other", name: "Other Hub" } }),
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  await assert.rejects(
    service.requestOffers({
      legId: leg.id, hubPointId: "hub_1",
      user: { id: "hub_dispatcher_1", role: "CUSTOMER" },
    }),
    error => error.statusCode === 403,
  );
});

test("hub dispatch delegation cannot accept fare proposals or create assignments for the customer", async () => {
  const service = createDeliveryLegDispatchService({
    prismaClient: {
      parcelBooking: { findUnique: async () => ({ id: "booking_1", senderId: "sender_1" }) },
    },
    repository: { findOfferByAcceptanceKey: async () => null },
    clock: () => now,
  });
  await assert.rejects(
    service.acceptFare({
      bookingId: "booking_1", legId: leg.id, offerId: "offer_1",
      user: { id: "hub_dispatcher_1", role: "CUSTOMER" },
      idempotencyKey: "hub-should-not-accept-fare-0001",
    }),
    error => error.statusCode === 403,
  );
});


test("a repeated fare proposal replays after the driver becomes unavailable", async () => {
  const offerId = "offer_retry";
  const idempotencyKey = "driver-fare-retry-after-acceptance";
  const proposedFareMinor = "2500";
  const proposalPayloadHash = createHash("sha256")
    .update(JSON.stringify({ offerId, proposedFareMinor }))
    .digest("hex");
  const repository = {
    transaction: callback => callback({
      driverProfile: {
        findUnique: async () => ({
          id: "profile_1",
          verificationStatus: "VERIFIED",
          isOnline: true,
          isAvailable: false,
        }),
      },
    }),
    findOfferForDriver: async () => ({
      id: offerId,
      driverProfileId: "profile_1",
      status: "ACCEPTED",
      proposedFareMinor: 2500n,
      proposalIdempotencyKey: idempotencyKey,
      proposalPayloadHash,
      currency: "NGN",
    }),
    updateOffer: async () => {
      throw new Error("An idempotent replay must not update the offer.");
    },
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.proposeFare({
    offerId,
    userId: "driver_user_1",
    proposedFareMinor,
    idempotencyKey,
  });

  assert.equal(result.replay, true);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.proposedFareMinor, proposedFareMinor);
});

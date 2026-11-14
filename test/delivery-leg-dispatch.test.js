import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createDeliveryLegDispatchService } from "../src/modules/delivery-legs/delivery-leg-dispatch.service.js";
import { createDeliveryLegDispatchRepository } from "../src/modules/delivery-legs/delivery-leg-dispatch.repository.js";

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
    kycTier: "FULL",
    suspendedAt: null,
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
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
    listActiveOffers: async () => [],
    findEligibleDrivers: async () => [
      validDriver("near_driver"),
      { ...validDriver("stale_driver"), lastLocationAt: new Date(now.getTime() - 6 * 60_000) },
      { ...validDriver("far_driver"), locations: [{ latitude: 7.5, longitude: 3.3, recordedAt: now }] },
      { ...validDriver("unverified_driver"), verificationStatus: "PENDING" },
      { ...validDriver("suspended_driver"), suspendedAt: now },
      { ...validDriver("unassessed_driver"), kycTier: "UNASSESSED" },
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
    findDriverProfile: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }),
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
      driverProfile: { findUnique: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }) },
      driverCapabilityGrant: { findFirst: async () => ({ id: "grant_1" }) },
      vehicle: { findMany: async () => [{ id: "vehicle_1" }] },
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
  assert.equal(offerUpdate.data.vehicleId, "vehicle_1");
  assert.equal(event.eventType, "DELIVERY_LEG_FARE_PROPOSED");
});

test("customer acceptance reserves one driver and creates an awaiting-payment leg assignment", async () => {
  let assignment;
  let legUpdate;
  const offer = {
    id: "offer_1", deliveryLegId: leg.id, driverProfileId: "profile_1",
    status: "OFFERED", vehicleId: "vehicle_1", proposedFareMinor: 2500n, currency: "NGN",
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
    vehicle: { findFirst: async () => ({ id: "vehicle_1" }) },
    driverCapabilityGrant: { findFirst: async () => ({ id: "grant_1" }) },
    driverProfile: {
      findFirst: async () => validDriver("profile_1"),
      updateMany: async () => ({ count: 1 }),
    },
    driverAssignment: { create: async (args) => { assignment = args; return { id: "assignment_1" }; } },
    serviceZone: { findMany: async () => [{ id: "zone_ikeja" }] },
    bookingEvent: { create: async () => ({}) },
  };
  const repository = {
    findOfferByAcceptanceKey: async () => null,
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
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
  assert.equal(assignment.data.vehicleId, "vehicle_1");
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
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
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
  const vehicleId = "vehicle_1";
  const proposalPayloadHash = createHash("sha256")
    .update(JSON.stringify({ offerId, vehicleId, proposedFareMinor }))
    .digest("hex");
  const repository = {
    transaction: callback => callback({
      driverProfile: {
        findUnique: async () => ({
          id: "profile_1",
          verificationStatus: "VERIFIED",
          kycTier: "FULL",
          suspendedAt: null,
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
    vehicleId,
    idempotencyKey,
  });

  assert.equal(result.replay, true);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.proposedFareMinor, proposedFareMinor);
});

test("TEST_LIMITED drivers cannot receive pickup-leg offers without an approvable pickup capability",async()=>{
  const repository={
    transaction:callback=>callback({}),findLeg:async()=>leg,findActiveServiceZones:async()=>[{id:"zone_ikeja"}],listActiveOffers:async()=>[],
    findEligibleDrivers:async()=>[],
  };
  const service=createDeliveryLegDispatchService({prismaClient:{},repository,clock:()=>now});
  await assert.rejects(
    service.requestOffers({legId:leg.id,user:{id:"sender_1",role:"CUSTOMER"}}),
    error=>error.code==="NO_ELIGIBLE_DRIVERS"&&error.statusCode===409,
  );
});


test("admin dispatch creates fixed-payout offers only for paid and released platform local shipments", async () => {
  let offers;
  const platformLeg = {
    ...leg,
    type: "LOCAL_PICKUP",
    parcelBooking: {
      ...leg.parcelBooking,
      senderId: null,
      integrationClientId: "integration_client_1",
      integrationDispatchAuthorizedAt: now,
      paymentStatus: "SUCCEEDED",
      status: "AWAITING_PARTNER_ASSIGNMENT",
      pricingSnapshot: { driverPayoutMinor: "3500" },
    },
    metadata: { pricingSource: "PLATFORM_ROUTE_RATE", driverPayoutMinor: "3500" },
  };
  const repository = {
    transaction: callback => callback({
      platformRouteAvailability: { findFirst: async () => ({ id: "route_availability_1" }) },
    }),
    findLeg: async () => platformLeg,
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
    listActiveOffers: async () => [],
    findEligibleDrivers: async () => [validDriver("platform_driver_1")],
    createOffers: async (_tx, data) => { offers = data; return { count: data.length }; },
    recordEvent: async () => {},
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.requestOffers({
    legId: platformLeg.id, user: { id: "admin_1", role: "ADMIN" },
  });
  assert.equal(result.offersCreated, 1);
  assert.equal(offers[0].fixedPayoutMinor, 3500n);
  assert.equal("proposedFareMinor" in offers[0], false);
});

test("driver fixed-payout acceptance creates an accepted assignment at the immutable payout", async () => {
  let assignment;
  let bookingUpdate;
  let projectedEvent;
  const platformLeg = {
    ...leg,
    type: "LOCAL_PICKUP",
    status: "READY_FOR_ASSIGNMENT",
    metadata: { pricingSource: "PLATFORM_ROUTE_RATE", driverPayoutMinor: "3500" },
    parcelBooking: {
      ...leg.parcelBooking,
      senderId: null,
      integrationClientId: "integration_client_1",
      integrationDispatchAuthorizedAt: now,
      paymentStatus: "SUCCEEDED",
      pricingSnapshot: { driverPayoutMinor: "3500" },
      status: "AWAITING_PARTNER_ASSIGNMENT",
    },
  };
  const offer = {
    id: "fixed_offer_1", deliveryLegId: platformLeg.id, driverProfileId: "profile_1",
    status: "OFFERED", proposedFareMinor: null, fixedPayoutMinor: 3500n,
    vehicleId: null, currency: "NGN", expiresAt: new Date(now.getTime() + 60_000),
    deliveryLeg: platformLeg,
  };
  const tx = {
    $queryRaw: async () => [],
    driverProfile: {
      findUnique: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }),
      findFirst: async () => validDriver("profile_1"),
      updateMany: async () => ({ count: 1 }),
    },
    deliveryLeg: {
      findUnique: async () => platformLeg,
      updateMany: async () => ({ count: 1 }),
    },
    deliveryLegOffer: { findUnique: async () => offer, updateMany: async () => ({ count: 1 }) },
    platformRouteAvailability: { findFirst: async () => ({ id: "route_availability_1" }) },
    vehicle: { findFirst: async () => ({ id: "vehicle_1" }) },
    driverCapabilityGrant: { findFirst: async () => ({ id: "grant_1" }) },
    parcelBooking: {
      updateMany: async args => { bookingUpdate = args; return { count: 1 }; },
      findUnique: async () => ({
        id: platformLeg.parcelBooking.id, integrationClientId: "integration_client_1",
        senderId: null, publicReference: "LH-PLATFORM-1", status: "DRIVER_ASSIGNED",
      }),
      update: async () => ({ integrationEventSequence: 1 }),
    },
    driverAssignment: { create: async args => { assignment = args; return { id: "assignment_fixed_1" }; } },
    bookingEvent: { create: async args => ({ id: "event_fixed_1", createdAt: now, ...args.data }) },
    integrationShipmentEvent: {
      findUnique: async () => null,
      create: async args => {
        projectedEvent = args.data;
        return { id: "external_event_1", sequence: args.data.sequence, eventType: args.data.eventType };
      },
    },
    integrationWebhookEndpoint: { findMany: async () => [] },
    integrationWebhookDelivery: { createMany: async () => ({ count: 0 }) },
  };
  const repository = {
    findOfferByAcceptanceKey: async () => null,
    acceptOfferTransaction: callback => callback(tx),
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.acceptFixedPayout({
    offerId: offer.id, userId: "driver_user_1", vehicleId: "vehicle_1",
    idempotencyKey: "fixed-payout-acceptance-0001",
  });
  assert.equal(result.assignmentId, "assignment_fixed_1");
  assert.equal(result.fixedPayoutMinor, "3500");
  assert.equal(assignment.data.status, "ACCEPTED");
  assert.equal(assignment.data.agreedFareMinor, 3500n);
  assert.equal(assignment.data.assignedByUserId, "driver_user_1");
  assert.equal(bookingUpdate.data.status, "DRIVER_ASSIGNED");
  assert.equal(result.status, "ACCEPTED");
  assert.equal(projectedEvent.eventType, "shipment.driver_assigned");
  assert.equal(projectedEvent.payload.status, "DRIVER_ASSIGNED");
});

test("fixed-payout driver offers expose the payout but never customer charge", async () => {
  const repository = {
    findDriverProfile: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }),
    findDriverOffers: async () => [{
      id: "fixed_offer_1", currency: "NGN", fixedPayoutMinor: 3500n, expiresAt: now, createdAt: now,
      deliveryLeg: {
        id: "leg_fixed", sequence: 1, type: "LOCAL_PICKUP",
        originServiceZone: { name: "Ikeja" }, destinationServiceZone: { name: "Ikeja" },
        originHubPoint: null, destinationHubPoint: null,
        parcelBooking: { publicReference: "LH-PLATFORM-1", parcelCategory: null, parcelSize: null, customerPayableMinor: 9000n },
      },
    }],
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const [offer] = await service.listDriverOffers({ userId: "driver_user_1" });
  assert.equal(offer.fixedPayoutMinor, "3500");
  assert.equal("customerPayableMinor" in offer.deliveryLeg.booking, false);
});


test("customer can request fixed-payout offers from an accepted platform route quote", async () => {
  let offers;
  const customerLeg = {
    ...leg,
    status: "READY_FOR_ASSIGNMENT",
    metadata: { quoteId: "quote_1", pricingSource: "PLATFORM_ROUTE_RATE", driverPayoutMinor: "3500" },
    parcelBooking: {
      ...leg.parcelBooking,
      senderId: "sender_1",
      integrationClientId: null,
      status: "AWAITING_PARTNER_ASSIGNMENT",
      paymentStatus: "INITIALIZED",
      pricingSnapshot: { source: "PLATFORM_ROUTE_RATE", quoteId: "quote_1", driverPayoutMinor: "3500" },
    },
  };
  const tx = { platformRouteAvailability: { findFirst: async () => ({ id: "route_availability_1" }) } };
  const repository = {
    transaction: callback => callback(tx),
    findLeg: async () => customerLeg,
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
    listActiveOffers: async () => [],
    findEligibleDrivers: async () => [validDriver("customer_driver_1")],
    createOffers: async (_tx, data) => { offers = data; return { count: data.length }; },
    recordEvent: async () => {},
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.requestOffers({
    legId: customerLeg.id,
    user: { id: "sender_1", role: "CUSTOMER" },
  });
  assert.equal(result.offersCreated, 1);
  assert.equal(offers[0].fixedPayoutMinor, 3500n);
  assert.equal("proposedFareMinor" in offers[0], false);
});

test("customer fixed-payout acceptance reserves driver and waits for payment before assignment", async () => {
  let assignment;
  let bookingUpdate;
  let legUpdate;
  const customerLeg = {
    ...leg,
    status: "READY_FOR_ASSIGNMENT",
    metadata: { quoteId: "quote_1", pricingSource: "PLATFORM_ROUTE_RATE", driverPayoutMinor: "3500" },
    parcelBooking: {
      ...leg.parcelBooking,
      senderId: "sender_1",
      integrationClientId: null,
      integrationDispatchAuthorizedAt: null,
      status: "AWAITING_PARTNER_ASSIGNMENT",
      paymentStatus: "INITIALIZED",
      pricingSnapshot: { source: "PLATFORM_ROUTE_RATE", quoteId: "quote_1", driverPayoutMinor: "3500" },
    },
  };
  const offer = {
    id: "customer_fixed_offer_1", deliveryLegId: customerLeg.id, driverProfileId: "profile_1",
    status: "OFFERED", proposedFareMinor: null, fixedPayoutMinor: 3500n,
    vehicleId: null, currency: "NGN", expiresAt: new Date(now.getTime() + 60_000),
    deliveryLeg: customerLeg,
  };
  const tx = {
    $queryRaw: async () => [],
    driverProfile: {
      findUnique: async () => ({ id: "profile_1", verificationStatus: "VERIFIED", kycTier: "FULL", suspendedAt: null, isOnline: true, isAvailable: true }),
      findFirst: async () => validDriver("profile_1"),
      updateMany: async () => ({ count: 1 }),
    },
    deliveryLeg: {
      findUnique: async () => customerLeg,
      updateMany: async args => { legUpdate = args; return { count: 1 }; },
    },
    deliveryLegOffer: { findUnique: async () => offer, updateMany: async () => ({ count: 1 }) },
    platformRouteAvailability: { findFirst: async () => ({ id: "route_availability_1" }) },
    vehicle: { findFirst: async () => ({ id: "vehicle_1" }) },
    driverCapabilityGrant: { findFirst: async () => ({ id: "grant_1" }) },
    parcelBooking: {
      updateMany: async args => { bookingUpdate = args; return { count: 1 }; },
      findUnique: async () => ({ id: "booking_1", senderId: "sender_1", integrationClientId: null, status: "AWAITING_PAYMENT" }),
    },
    driverAssignment: { create: async args => { assignment = args; return { id: "customer_assignment_1" }; } },
    bookingEvent: { create: async () => ({ id: "customer_event_1", createdAt: now }) },
  };
  const repository = {
    findOfferByAcceptanceKey: async () => null,
    acceptOfferTransaction: callback => callback(tx),
    findActiveServiceZones: async () => [{ id: "zone_ikeja" }],
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const result = await service.acceptFixedPayout({
    offerId: offer.id,
    userId: "driver_user_1",
    vehicleId: "vehicle_1",
    idempotencyKey: "customer-fixed-payout-acceptance-0001",
  });
  assert.equal(result.status, "AWAITING_PAYMENT");
  assert.equal(result.paymentRequired, true);
  assert.equal(result.fixedPayoutMinor, "3500");
  assert.equal(assignment.data.status, "AWAITING_PAYMENT");
  assert.equal(assignment.data.agreedFareMinor, 3500n);
  assert.equal(assignment.data.paymentExpiresAt.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString());
  assert.equal(legUpdate.data.status, "AWAITING_PAYMENT");
  assert.equal(bookingUpdate.data.status, "AWAITING_PAYMENT");
  assert.deepEqual(bookingUpdate.where.paymentStatus, { in: ["INITIALIZED", "FAILED"] });
});


test("fixed-payout acceptance replay preserves the pending customer payment reservation", async () => {
  const offer = {
    id: "customer_fixed_offer_replay",
    deliveryLegId: "customer_leg_replay",
    driverProfileId: "profile_1",
    acceptancePayloadHash: createHash("sha256")
      .update(JSON.stringify({ offerId: "customer_fixed_offer_replay", vehicleId: "vehicle_1", userId: "driver_user_1" }))
      .digest("hex"),
    fixedPayoutMinor: 3500n,
    currency: "NGN",
  };
  const paymentExpiresAt = new Date(now.getTime() + 15 * 60_000);
  const repository = {
    findOfferByAcceptanceKey: async () => offer,
    findDriverProfile: async () => ({ id: "profile_1" }),
  };
  const service = createDeliveryLegDispatchService({
    prismaClient: {
      driverAssignment: {
        findFirst: async () => ({ id: "assignment_1", status: "AWAITING_PAYMENT", agreedFareMinor: 3500n, paymentExpiresAt }),
      },
    },
    repository,
    clock: () => now,
  });
  const result = await service.acceptFixedPayout({
    offerId: offer.id,
    userId: "driver_user_1",
    vehicleId: "vehicle_1",
    idempotencyKey: "fixed-payout-replay-key-0001",
  });
  assert.equal(result.replay, true);
  assert.equal(result.paymentRequired, true);
  assert.equal(result.paymentExpiresAt, paymentExpiresAt);
  assert.equal(result.status, "AWAITING_PAYMENT");
});


test("customer fixed-payout offers serialize without a null fare-proposal crash", async () => {
  const fixedOffer = {
    id: "fixed_offer_1",
    status: "OFFERED",
    proposedFareMinor: null,
    fixedPayoutMinor: 4200n,
    currency: "NGN",
    expiresAt: new Date(now.getTime() + 60_000),
    driverProfile: {
      user: { fullName: "Verified Driver" },
      averageRating: 4.8,
      completedJobs: 12,
    },
    vehicle: { type: "MOTORCYCLE", make: "Honda", model: "CBR" },
  };
  const repository = {
    findBookingForCustomer: async () => ({ id: "booking_1", senderId: "sender_1" }),
    findCustomerOffers: async () => [fixedOffer],
  };
  const service = createDeliveryLegDispatchService({ prismaClient: {}, repository, clock: () => now });
  const offers = await service.listCustomerOffers({
    bookingId: "booking_1",
    legId: "leg_1",
    user: { id: "sender_1", role: "CUSTOMER" },
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].proposedFareMinor, null);
  assert.equal("fixedPayoutMinor" in offers[0], false);
  assert.equal(offers[0].currency, "NGN");
});


test("customer offer repository includes fixed-payout offers without selecting payout for the customer", async () => {
  let query;
  const repository = createDeliveryLegDispatchRepository({
    deliveryLegOffer: {
      findMany: async args => { query = args; return []; },
    },
  });
  await repository.findCustomerOffers("booking_1", "leg_1");
  assert.deepEqual(query.where.OR, [
    { proposedFareMinor: { not: null } },
    { fixedPayoutMinor: { not: null } },
  ]);
});


test("a delegated hub operator can request a fixed-payout driver offer for an approved recovery final-mile leg", async () => {
  const packageFacts = [{
    id: "recovery-package-1", packageSequence: 1, packageCategory: "GENERAL",
    weightGrams: 500, lengthMm: 100, widthMm: 100, heightMm: 100,
  }];
  const quote = {
    id: "recovery-accepted-quote", status: "ACCEPTED", currency: "NGN",
    inputSnapshot: {
      source: "PLATFORM_OPERATIONAL_TARIFF",
      operationalTariffAssessment: { legs: [{
        sequence: 1, type: "LOCAL_PICKUP",
        packages: packageFacts.map(pkg => ({
          packageId: pkg.id, packageSequence: pkg.packageSequence,
          packageCategory: pkg.packageCategory, weightGrams: pkg.weightGrams,
          dimensionsMm: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
        })),
      }] },
      routeSnapshot: { legs: [] },
    },
  };
  const booking = {
    id: "recovery-booking", senderId: "sender-1", publicReference: "LH-RECOVERY-1",
    status: "IN_TRANSIT", paymentStatus: "SUCCEEDED", currency: "NGN",
    integrationClientId: null, integrationDispatchAuthorizedAt: null,
    destinationLatitude: 6.525, destinationLongitude: 3.38,
    parcelPackages: packageFacts, quotes: [quote],
  };
  const recoveryLeg = {
    id: "recovery-final-mile", parcelBookingId: booking.id, sequence: 2,
    type: "FINAL_MILE", status: "READY_FOR_ASSIGNMENT",
    originServiceZoneId: "zone-hub", destinationServiceZoneId: "zone-final",
    originHubPointId: "hub-recovery", destinationHubPointId: null,
    originLatitude: 6.5244, originLongitude: 3.3792,
    destinationLatitude: booking.destinationLatitude, destinationLongitude: booking.destinationLongitude,
    metadata: {
      source: "DRV-05C-D2_HUB_RECOVERY",
      executionSnapshotId: "recovery-execution-snapshot",
      sourceIntakeRecordId: "intake-recovery",
      sourceDeliveryLegId: "failed-source-leg",
      hubRecoveryId: "hub-recovery-record",
    },
    parcelBooking: booking,
  };
  const disposition = {
    id: "recovery-disposition", intakeRecordId: "intake-recovery",
    hubRecoveryId: "hub-recovery-record", parcelBookingId: booking.id,
    sourceDeliveryLegId: "failed-source-leg", hubPointId: "hub-recovery",
    decision: "CONTINUE_DELIVERY", status: "ROUTE_APPROVED",
    destinationServiceZoneId: "zone-final", destinationHubPointId: null,
    nextDeliveryLegId: recoveryLeg.id,
    intakeRecord: {
      id: "intake-recovery", status: "RECEIVED", parcelBookingId: booking.id,
      deliveryLegId: "failed-source-leg", hubPointId: "hub-recovery",
    },
    hubRecovery: {
      id: "hub-recovery-record", status: "CONFIRMED", parcelBookingId: booking.id,
      deliveryLegId: "failed-source-leg", hubPointId: "hub-recovery",
      hubIntakeRecordId: "intake-recovery",
    },
    sourceDeliveryLeg: {
      id: "failed-source-leg", parcelBookingId: booking.id, sequence: 1,
      status: "FAILED", failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED",
    },
    hubPoint: {
      id: "hub-recovery", serviceZoneId: "zone-hub", latitude: 6.5244, longitude: 3.3792,
    },
    destinationHubPoint: null,
  };
  const selectedDriver = {
    ...validDriver("selected-recovery-driver"),
    serviceRadiusMeters: 5000,
    lastLocationAt: now,
    locations: [{ latitude: 6.5244, longitude: 3.3792, recordedAt: now }],
  };
  const selectedSnapshot = {
    id: "recovery-execution-snapshot",
    deliveryLegId: recoveryLeg.id,
    executorType: "PLATFORM_DRIVER",
    selectedDriverProfileId: selectedDriver.id,
    selectedVehicleId: "recovery-vehicle",
    executionCostMinor: 30000n,
    currency: "NGN",
    assessmentSnapshot: {
      execution: {
        payoutAssessment: {
          status: "RESOLVED",
          serviceZoneId: "zone-final",
          legType: "FINAL_MILE",
          totalDriverPayoutMinor: "30000",
          currency: "NGN",
          packages: [{
            packageId: "recovery-package-1",
            packageSequence: 1,
            packageCategory: "GENERAL",
            weightGrams: 500,
            rule: {
              id: "final-mile-payout-rule",
              version: 2,
              serviceZoneId: "zone-final",
              legType: "FINAL_MILE",
              parcelCategory: "GENERAL",
              minWeightGrams: 0,
              maxWeightGrams: 1000,
              currency: "NGN",
              driverPayoutMinor: "30000",
              effectiveFrom: "2026-10-01T00:00:00.000Z",
              effectiveUntil: null,
            },
          }],
        },
      },
    },
  };
  const hub = {
    id: "hub-recovery", status: "ACTIVE", operatorVerificationStatus: "VERIFIED",
    serviceZoneId: "zone-hub", acceptedParcelTypes: ["GENERAL"],
    capacityConfig: { maxParcels: 10 },
    serviceZone: {
      id: "zone-hub", isActive: true,
      state: { isActive: true, country: { isActive: true } },
      availability: [{ id: "hub-availability" }],
    },
  };
  const tx = {
    hubPoint: { findUnique: async () => ({ id: "hub-recovery", status: "ACTIVE" }) },
    hubPointOperator: { findUnique: async () => ({ isActive: true, canDispatch: true }) },
    deliveryLeg: {
      findUnique: async () => recoveryLeg,
      findFirst: async () => ({
        id: "failed-source-leg", sequence: 1, status: "FAILED", completedAt: null,
        failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED",
      }),
    },
    deliveryLegExecutionSnapshot: { findFirst: async () => selectedSnapshot },
    hubIntakeDisposition: { findUnique: async () => disposition },
    hubPoint: { findUnique: async () => hub },
    serviceZone: { findMany: async ({ where }) => where.id.in.map(id => ({ id })) },
    hubIntakeRecord: { findMany: async () => [] },
    driverProfile: { findMany: async () => [selectedDriver] },
    platformDriverPayoutRule: {
      findMany: async () => [{
        id: "final-mile-payout-rule", version: 2,
        serviceZoneId: "zone-final", legType: "FINAL_MILE",
        parcelCategory: "GENERAL", minWeightGrams: 0, maxWeightGrams: 1000,
        currency: "NGN", driverPayoutMinor: 30000n,
        effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
        effectiveUntil: null, status: "ACTIVE",
      }],
    },
  };
  let offers;
  let event;
  const repository = {
    transaction: callback => callback(tx),
    findLeg: async () => recoveryLeg,
    findActiveServiceZones: async () => [{ id: "zone-hub" }, { id: "zone-final" }],
    listActiveOffers: async () => [],
    findEligibleDrivers: async () => [selectedDriver],
    createOffers: async (_tx, data) => { offers = data; return { count: data.length }; },
    recordEvent: async (_tx, data) => { event = data; },
  };
  const service = createDeliveryLegDispatchService({
    prismaClient: {}, repository, clock: () => now,
  });

  const result = await service.requestOffers({
    legId: recoveryLeg.id,
    hubPointId: "hub-recovery",
    user: { id: "hub-operator-1", role: "HUB_OPERATOR" },
  });

  assert.equal(result.offersCreated, 1);
  assert.equal(offers[0].driverProfileId, selectedDriver.id);
  assert.equal(offers[0].vehicleId, "recovery-vehicle");
  assert.equal(offers[0].fixedPayoutMinor, 30000n);
  assert.equal(offers[0].currency, "NGN");
  assert.equal(event.eventType, "DELIVERY_LEG_MATCHING_REQUESTED");
});

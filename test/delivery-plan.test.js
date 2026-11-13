import test from "node:test";
import assert from "node:assert/strict";
import { createMultiLegPlan } from "../src/modules/delivery-legs/delivery-plan.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");

function booking(overrides = {}) {
  return {
    id: "booking_interstate",
    pickupServiceZoneId: "zone_lagos",
    destinationServiceZoneId: "zone_ogun",
    pickupLatitude: 6.5244,
    pickupLongitude: 3.3792,
    destinationLatitude: 6.8,
    destinationLongitude: 3.5,
    parcelCategory: "BOX",
    ...overrides,
  };
}

function hub(id, serviceZoneId, latitude, longitude) {
  return {
    id,
    name: id,
    status: "ACTIVE",
    operatorVerificationStatus: "VERIFIED",
    serviceZoneId,
    latitude,
    longitude,
    acceptedParcelTypes: ["BOX"],
    capacityConfig: { maxParcels: 20 },
  };
}

function transaction({ zones, hubs }) {
  const created = [];
  return {
    created,
    tx: {
      serviceZone: { findMany: async () => zones },
      hubPoint: { findMany: async () => hubs },
      deliveryLeg: {
        create: async ({ data }) => {
          const leg = { id: `leg_${created.length + 1}`, ...data };
          created.push(leg);
          return {
            id: leg.id,
            sequence: leg.sequence,
            type: leg.type,
            status: leg.status,
            originServiceZoneId: leg.originServiceZoneId,
            destinationServiceZoneId: leg.destinationServiceZoneId,
            originHubPointId: leg.originHubPointId,
            destinationHubPointId: leg.destinationHubPointId,
          };
        },
      },
    },
  };
}

test("cross-state quote creates ordered pickup, trunk and final-mile legs when suitable hubs exist", async () => {
  const incompatibleHub = hub("wrong_parcel_type", "zone_ogun", 6.81, 3.51);
  incompatibleHub.acceptedParcelTypes = ["DOCUMENT"];
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-OG" },
    ],
    hubs: [
      hub("origin_hub_near", "zone_lagos", 6.525, 3.38),
      hub("origin_hub_far", "zone_lagos", 6.7, 3.6),
      hub("destination_hub", "zone_ogun", 6.81, 3.51),
      incompatibleHub,
    ],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking(),
    quote: { id: "quote_1" },
    now,
  });

  assert.equal(plan.routeMode, "HUB_ASSISTED");
  assert.equal(plan.originHub.id, "origin_hub_near");
  assert.equal(plan.destinationHub.id, "destination_hub");
  assert.deepEqual(created.map((leg) => [leg.sequence, leg.type, leg.status]), [
    [1, "LOCAL_PICKUP", "READY_FOR_ASSIGNMENT"],
    [2, "INTERSTATE_TRANSPORT", "PLANNED"],
    [3, "FINAL_MILE", "PLANNED"],
  ]);
  assert.equal(created[0].destinationHubPointId, "origin_hub_near");
  assert.equal(created[1].originHubPointId, "origin_hub_near");
  assert.equal(created[1].destinationHubPointId, "destination_hub");
  assert.equal(created[2].originHubPointId, "destination_hub");
  assert.equal(created[1].metadata.quoteId, "quote_1");
});

test("cross-state quote falls back to an end-to-end leg when hub coverage is incomplete", async () => {
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-OG" },
    ],
    hubs: [hub("origin_hub", "zone_lagos", 6.525, 3.38)],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking(),
    quote: { id: "quote_2" },
    now,
  });

  assert.equal(plan.routeMode, "END_TO_END");
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "INTERSTATE_TRANSPORT");
  assert.equal(created[0].status, "READY_FOR_ASSIGNMENT");
  assert.equal(created[0].originHubPointId, null);
  assert.equal(created[0].destinationHubPointId, null);
  assert.deepEqual(created[0].metadata, {
    quoteId: "quote_2",
    routePlanVersion: 1,
    driverPayoutMinor: null,
    pricingSource: "CONTRACTED_PARTNER_RATE",
  });
});



test("multi-package hub selection requires capacity for the full consignment", async () => {
  const originHub = hub("origin_hub", "zone_lagos", 6.525, 3.38);
  const destinationHub = hub("destination_hub", "zone_ogun", 6.81, 3.51);
  originHub.capacityConfig = { maxParcels: 1 };
  destinationHub.capacityConfig = { maxParcels: 10 };
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-OG" },
    ],
    hubs: [originHub, destinationHub],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking({ packages: [{ packageCategory: "BOX" }, { packageCategory: "BOX" }] }),
    quote: { id: "quote_capacity" },
    now,
  });

  assert.equal(plan.routeMode, "END_TO_END");
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "INTERSTATE_TRANSPORT");
});

test("an end-to-end quote pins its topology if hubs become eligible before plan creation", async () => {
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-OG" },
    ],
    hubs: [
      hub("origin_hub", "zone_lagos", 6.525, 3.38),
      hub("destination_hub", "zone_ogun", 6.81, 3.51),
    ],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking(),
    quote: { id: "quote_pinned", inputSnapshot: { routeSnapshot: { routeMode: "END_TO_END" } } },
    now,
  });

  assert.equal(plan.routeMode, "END_TO_END");
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "INTERSTATE_TRANSPORT");
  assert.equal(created[0].originHubPointId, null);
  assert.equal(created[0].destinationHubPointId, null);
});

test("same-state quote does not create an unnecessary hub-assisted route", async () => {
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
    ],
    hubs: [],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking({ destinationServiceZoneId: "zone_lagos" }),
    quote: { id: "quote_3" },
    now,
  });

  assert.equal(plan.routeMode, "LOCAL_DIRECT");
  assert.deepEqual(plan.legs, []);
  assert.equal(created.length, 0);
});


test("integration hub-assisted quote preserves pinned hubs and creates HAT legs awaiting execution review", async () => {
  const routeSnapshot = {
    routeMode: "HUB_ASSISTED",
    legs: [
      {
        sequence: 1, type: "LOCAL_PICKUP",
        originServiceZoneId: "zone_lagos", destinationServiceZoneId: "zone_lagos",
        originHubPointId: null, destinationHubPointId: "origin_hub",
        origin: { latitude: 6.5244, longitude: 3.3792 },
        destination: { latitude: 6.525, longitude: 3.38 },
      },
      {
        sequence: 2, type: "INTERSTATE_TRANSPORT",
        originServiceZoneId: "zone_lagos", destinationServiceZoneId: "zone_ogun",
        originHubPointId: "origin_hub", destinationHubPointId: "destination_hub",
        origin: { latitude: 6.525, longitude: 3.38 },
        destination: { latitude: 6.81, longitude: 3.51 },
      },
      {
        sequence: 3, type: "FINAL_MILE",
        originServiceZoneId: "zone_ogun", destinationServiceZoneId: "zone_ogun",
        originHubPointId: "destination_hub", destinationHubPointId: null,
        origin: { latitude: 6.81, longitude: 3.51 },
        destination: { latitude: 6.8, longitude: 3.5 },
      },
    ],
  };
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-OG" },
    ],
    hubs: [
      hub("origin_hub", "zone_lagos", 6.525, 3.38),
      hub("destination_hub", "zone_ogun", 6.81, 3.51),
    ],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking({ packages: [{ packageCategory: "BOX" }] }),
    quote: {
      id: "integration_quote",
      inputSnapshot: { source: "INTEGRATION_QUOTE", routeSnapshot },
    },
    now,
  });

  assert.equal(plan.routeMode, "HUB_ASSISTED");
  assert.equal(plan.originHub.id, "origin_hub");
  assert.equal(plan.destinationHub.id, "destination_hub");
  assert.deepEqual(created.map(leg => [leg.sequence, leg.type, leg.status]), [
    [1, "LOCAL_PICKUP", "PLANNED"],
    [2, "INTERSTATE_TRANSPORT", "PLANNED"],
    [3, "FINAL_MILE", "PLANNED"],
  ]);
  assert.ok(created.every(leg => leg.metadata.pricingSource === "PLATFORM_OPERATIONAL_TARIFF"));
  assert.ok(created.every(leg => leg.metadata.requiresOperationalReview === true));
});

test("integration hub-assisted quote rejects a changed or incomplete pinned hub topology", async () => {
  const routeSnapshot = {
    routeMode: "HUB_ASSISTED",
    legs: [
      { sequence: 1, type: "LOCAL_PICKUP", originServiceZoneId: "zone_lagos", destinationServiceZoneId: "zone_lagos", originHubPointId: null, destinationHubPointId: "origin_hub", origin: { latitude: 6.5, longitude: 3.3 }, destination: { latitude: 6.5, longitude: 3.3 } },
      { sequence: 2, type: "INTERSTATE_TRANSPORT", originServiceZoneId: "zone_lagos", destinationServiceZoneId: "zone_ogun", originHubPointId: "origin_hub", destinationHubPointId: "missing_hub", origin: { latitude: 6.5, longitude: 3.3 }, destination: { latitude: 6.8, longitude: 3.5 } },
      { sequence: 3, type: "FINAL_MILE", originServiceZoneId: "zone_ogun", destinationServiceZoneId: "zone_ogun", originHubPointId: "missing_hub", destinationHubPointId: null, origin: { latitude: 6.8, longitude: 3.5 }, destination: { latitude: 6.8, longitude: 3.5 } },
    ],
  };
  const { tx } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-OG" },
    ],
    hubs: [hub("origin_hub", "zone_lagos", 6.5, 3.3)],
  });
  await assert.rejects(
    createMultiLegPlan({
      tx,
      booking: booking({ packages: [{ packageCategory: "BOX" }] }),
      quote: { id: "integration_quote", inputSnapshot: { source: "INTEGRATION_QUOTE", routeSnapshot } },
      now,
    }),
    error => error.code === "DELIVERY_ROUTE_SNAPSHOT_INVALID",
  );
});

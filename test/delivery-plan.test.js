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
  assert.deepEqual(created[0].metadata, { quoteId: "quote_2", routePlanVersion: 1 });
});

test("same-state quote does not create an unnecessary hub-assisted route", async () => {
  const { tx, created } = transaction({
    zones: [
      { id: "zone_lagos", stateId: "NG-LA" },
      { id: "zone_ogun", stateId: "NG-LA" },
    ],
    hubs: [],
  });
  const plan = await createMultiLegPlan({
    tx,
    booking: booking(),
    quote: { id: "quote_3" },
    now,
  });

  assert.equal(plan.routeMode, "LOCAL_DIRECT");
  assert.deepEqual(plan.legs, []);
  assert.equal(created.length, 0);
});

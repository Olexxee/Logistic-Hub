import test from "node:test";
import assert from "node:assert/strict";
import { prepareServiceZoneBoundaries, resolveServiceZoneForPoint } from "../src/modules/geography/service-zone-resolution.js";
import { createParcelBookingsService } from "../src/modules/parcels/parcel-bookings.service.js";

const exterior = [[3, 6], [4, 6], [4, 7], [3, 7], [3, 6]];
const hole = [[3.4, 6.4], [3.6, 6.4], [3.6, 6.6], [3.4, 6.6], [3.4, 6.4]];
const zone = (id, boundaryGeoJson = { type: "Polygon", coordinates: [exterior] }) => ({ id, boundaryGeoJson });
const point = (longitude, latitude) => ({ longitude, latitude });

test("resolves a point inside a Polygon and treats its exterior edge as inclusive", () => {
  const prepared = prepareServiceZoneBoundaries([zone("zone-a")]);
  assert.equal(resolveServiceZoneForPoint(prepared, point(3.5, 6.5)).status, "resolved");
  const edge = resolveServiceZoneForPoint(prepared, point(3, 6.5));
  assert.equal(edge.status, "resolved");
  assert.equal(edge.classification, "boundary");
});

test("excludes Polygon holes, including their boundary", () => {
  const prepared = prepareServiceZoneBoundaries([zone("zone-a", { type: "Polygon", coordinates: [exterior, hole] })]);
  assert.equal(resolveServiceZoneForPoint(prepared, point(3.5, 6.5)).status, "not-found");
  assert.equal(resolveServiceZoneForPoint(prepared, point(3.4, 6.5)).status, "not-found");
});

test("resolves MultiPolygon components and skips zones without a boundary", () => {
  const multi = { type: "MultiPolygon", coordinates: [[exterior], [[[5, 6], [6, 6], [6, 7], [5, 7], [5, 6]]]] };
  const prepared = prepareServiceZoneBoundaries([zone("zone-null", null), zone("zone-multi", multi)]);
  assert.equal(resolveServiceZoneForPoint(prepared, point(5.5, 6.5)).zone.id, "zone-multi");
  assert.equal(resolveServiceZoneForPoint(prepared, point(8, 8)).status, "not-found");
});

test("fails closed when multiple active zones contain or touch the coordinate", () => {
  const prepared = prepareServiceZoneBoundaries([zone("zone-a"), zone("zone-b")]);
  const result = resolveServiceZoneForPoint(prepared, point(3.5, 6.5));
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.zoneIds, ["zone-a", "zone-b"]);
});

test("fails closed when an active service zone has an invalid stored boundary", () => {
  const prepared = prepareServiceZoneBoundaries([zone("zone-bad", { type: "Polygon", coordinates: [] })]);
  assert.equal(prepared.status, "invalid-boundary");
  assert.equal(prepared.zoneId, "zone-bad");
});

test("parcel booking persists server-resolved zone IDs and uses the resolved pickup zone for pricing", async () => {
  const zones = [
    { ...zone("pickup-zone"), state: { id: "state-a", code: "NG-LA", name: "Lagos" }, lga: { id: "lga-a", code: "IKEJA", name: "Ikeja" } },
    { ...zone("destination-zone", { type: "Polygon", coordinates: [[[5, 6], [6, 6], [6, 7], [5, 7], [5, 6]]] }), state: { id: "state-b", code: "NG-OG", name: "Ogun" }, lga: null },
  ];
  let saved;
  let pricedZone;
  const service = createParcelBookingsService({
    clock: () => new Date("2026-11-09T12:00:00.000Z"),
    repository: {
      findByIdempotencyKey: async () => null,
      findServiceableParcelZones: async () => zones,
      findApplicablePricingRules: async zoneId => {
        pricedZone = zoneId;
        return [{ id: "pricing-1", serviceZoneId: zoneId, currency: "NGN", fixedConnectionFeeMinor: 100n, minimumDriverFareMinor: 200n, version: 1 }];
      },
      createWithEvent: async data => { saved = data; return { ...data, id: "booking-1", createdAt: new Date(), updatedAt: new Date() }; },
    },
  });
  const result = await service.createDraft({
    senderId: "sender-1", idempotencyKey: "booking-create-geo03",
    input: {
      pickupAddress: "Ikeja, Lagos", pickup: { latitude: 6.5, longitude: 3.5 },
      destinationAddress: "Ogun", destination: { latitude: 6.5, longitude: 5.5 },
      recipientName: "Recipient", recipientPhone: "+2348000000000", parcelCategory: "documents", parcelSize: "small",
    },
  });
  assert.equal(saved.pickupServiceZoneId, "pickup-zone");
  assert.equal(saved.destinationServiceZoneId, "destination-zone");
  assert.equal(pricedZone, "pickup-zone");
  assert.equal(result.booking.pickupServiceZoneId, "pickup-zone");
});

test("parcel booking rejects a client zone hint that conflicts with coordinate resolution", async () => {
  const service = createParcelBookingsService({ repository: {
    findByIdempotencyKey: async () => null,
    findServiceableParcelZones: async () => [zone("authoritative-zone")],
    findApplicablePricingRules: async () => [],
  } });
  await assert.rejects(() => service.createDraft({
    senderId: "sender-1", idempotencyKey: "booking-create-geo04",
    input: {
      pickupServiceZoneId: "forged-zone",
      pickupAddress: "Test address", pickup: { latitude: 6.5, longitude: 3.5 },
      destinationAddress: "Test address", destination: { latitude: 6.5, longitude: 3.5 },
      recipientName: "Recipient", recipientPhone: "+2348000000000", parcelCategory: "documents", parcelSize: "small",
    },
  }), error => error.code === "SERVICE_ZONE_RESOLUTION_MISMATCH");
});

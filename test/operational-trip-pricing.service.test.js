import test from "node:test";
import assert from "node:assert/strict";
import { createOperationalTripPricingService, validateOperationalTripQuote } from "../src/modules/partner-pricing/operational-trip-pricing.service.js";

const now = new Date("2026-11-10T12:00:00.000Z");
const localBooking = {
  id: "booking-1", publicReference: "LH-TEST-1", status: "DRAFT", currency: "NGN",
  pickupServiceZoneId: "zone-a", destinationServiceZoneId: "zone-b",
  pickupLatitude: 7.4, pickupLongitude: 4.2, destinationLatitude: 7.5, destinationLongitude: 4.3,
  parcelPackages: [{ id: "package-1", packageCategory: "DOCUMENT", weightGrams: 250, lengthMm: null, widthMm: null, heightMm: null }],
};
function harness(booking = localBooking) {
  const calls = { created: [], events: [], audits: [] };
  const zones = [
    { id: "zone-a", code: "A", name: "Origin", stateId: "state-a" },
    { id: "zone-b", code: "B", name: "Destination", stateId: booking.destinationStateId ?? "state-a" },
  ];
  const tx = {
    parcelBooking: {
      findUnique: async () => booking,
      updateMany: async () => ({ count: 1 }),
    },
    serviceZone: { findMany: async () => zones },
    hubPoint: { findMany: async () => [] },
    partnerAgreement: { findFirst: async () => null },
    shipmentQuote: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }) => {
        calls.created.push(data);
        return { id: "quote-1", ...data, offeredAt: now, acceptedAt: null };
      },
    },
    bookingEvent: { create: async ({ data }) => { calls.events.push(data); return data; } },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
  };
  const prismaClient = { $transaction: async work => work(tx) };
  return { tx, calls, service: createOperationalTripPricingService({ prismaClient, clock: () => now }) };
}
const input = {
  reason: "Approved one-off operational price",
  expiresInMinutes: 60,
  legs: [{ sequence: 1, type: "LOCAL_PICKUP", executionType: "DRIVER", customerChargeMinor: "1000", driverPayoutMinor: "700" }],
  collectionChargeMinor: "0", hubHandlingChargeMinor: "0", destinationDeliveryChargeMinor: "0",
  platformChargeMinor: "200", otherChargesMinor: "0",
};

test("issues a booking-specific per-leg quote and keeps driver payout private", async () => {
  const { service, calls } = harness();
  const result = await service.issueQuote({ bookingId: localBooking.id, actorUserId: "admin-1", input });
  assert.equal(result.quote.totalCustomerChargeMinor, "1200");
  assert.equal(result.quote.transportChargeMinor, "1000");
  assert.equal("driverPayoutMinor" in result.quote, false);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].inputSnapshot.source, "ADMIN_OPERATIONAL_TRIP");
  assert.equal(calls.created[0].inputSnapshot.driverPayoutMinor, "700");
  assert.equal(calls.created[0].chargeBreakdown.legs[0].customerChargeMinor, "1000");
  assert.equal(calls.events[0].actorUserId, "admin-1");
  assert.equal(calls.audits[0].reason, input.reason);
});

test("rejects a route without a LOCAL_PICKUP driver leg instead of creating a payable quote", async () => {
  const booking = { ...localBooking, destinationStateId: "state-b" };
  const { service, calls } = harness(booking);
  const result = await service.issueQuote({
    bookingId: booking.id, actorUserId: "admin-1",
    input: { ...input, legs: [{ sequence: 1, type: "INTERSTATE_TRANSPORT", executionType: "PARTNER",
      customerChargeMinor: "1000", partnerId: "partner-1", agreementId: "agreement-1", executionCostMinor: "800" }] },
  });
  assert.equal(result.driverLegRequired, true);
  assert.equal(calls.created.length, 0);
});

test("revalidates operational quote route topology and internal execution snapshot", async () => {
  const { service, tx } = harness();
  const result = await service.issueQuote({ bookingId: localBooking.id, actorUserId: "admin-1", input });
  const quote = {
    currency: "NGN",
    inputSnapshot: {
      source: "ADMIN_OPERATIONAL_TRIP",
      routeSnapshot: {
        routeMode: "LOCAL_DIRECT",
        origin: { serviceZoneId: "zone-a", code: "A", name: "Origin", latitude: 7.4, longitude: 4.2 },
        destination: { serviceZoneId: "zone-b", code: "B", name: "Destination", latitude: 7.5, longitude: 4.3 },
        originHub: null, destinationHub: null, routePlanVersion: 1,
        legs: [{ sequence: 1, type: "LOCAL_PICKUP", originServiceZoneId: "zone-a", destinationServiceZoneId: "zone-b",
          originHubPointId: null, destinationHubPointId: null,
          origin: { latitude: 7.4, longitude: 4.2 }, destination: { latitude: 7.5, longitude: 4.3 } }],
      },
      operationalLegs: [{ sequence: 1, type: "LOCAL_PICKUP", executionType: "DRIVER", driverPayoutMinor: "700" }],
    },
  };
  assert.equal(await validateOperationalTripQuote(tx, localBooking, quote, now), true);
  assert.equal(result.quote.totalCustomerChargeMinor, "1200");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerShipmentQuotesService } from "../src/modules/parcels/customer-shipment-quotes.service.js";

const now = new Date("2026-11-10T12:00:00.000Z");
const booking = overrides => ({
  id: "booking-1",
  senderId: "sender-1",
  status: "DRAFT",
  currency: "NGN",
  pickupServiceZoneId: "zone-a",
  destinationServiceZoneId: "zone-b",
  pickupLatitude: 7.4,
  pickupLongitude: 4.2,
  destinationLatitude: 7.5,
  destinationLongitude: 4.3,
  parcelPackages: [{
    id: "package-1",
    packageSequence: 1,
    externalPackageRef: null,
    packageCategory: "DOCUMENT",
    weightGrams: 250,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
  }],
  ...overrides,
});

function createHarness({ bookingRecord = booking(), availability = true, rates = [] } = {}) {
  const calls = { quoteCreate: [], quoteUpdate: [], bookingUpdate: [] };
  const tx = {
    parcelBooking: {
      findUnique: async () => bookingRecord,
      updateMany: async args => { calls.bookingUpdate.push(args); return { count: 1 }; },
    },
    serviceZone: {
      findMany: async () => [
        { id: "zone-a", code: "A", name: "Zone A", stateId: "state-1" },
        { id: "zone-b", code: "B", name: "Zone B", stateId: "state-1" },
      ],
    },
    platformRouteAvailability: {
      findFirst: async () => availability ? { id: "availability-1" } : null,
    },
    platformRouteRate: { findMany: async () => rates },
    shipmentQuote: {
      findFirst: async () => null,
      updateMany: async args => { calls.quoteUpdate.push(args); return { count: 1 }; },
      create: async ({ data }) => {
        calls.quoteCreate.push(data);
        return {
          id: "quote-1",
          parcelBookingId: data.parcelBookingId,
          version: data.version,
          status: data.status,
          currency: data.currency,
          ...data,
          offeredAt: now,
          acceptedAt: null,
        };
      },
    },
  };
  const prismaClient = {
    $transaction: async work => work(tx),
  };
  return { service: createCustomerShipmentQuotesService({ prismaClient, clock: () => now }), calls };
}

const platformRate = {
  id: "rate-1",
  parcelCategory: "DOCUMENT",
  minWeightGrams: 1,
  maxWeightGrams: 1000,
  maxLengthMm: null,
  maxWidthMm: null,
  maxHeightMm: null,
  customerTransportChargeMinor: 1000n,
  platformChargeMinor: 200n,
  driverPayoutMinor: 700n,
  estimatedTransitMinutes: 90,
  version: 3,
};

test("creates a customer-visible platform route quote while keeping driver payout internal", async () => {
  const { service, calls } = createHarness({ rates: [platformRate] });
  const result = await service.createQuote({ bookingId: "booking-1", userId: "sender-1" });

  assert.equal(result.assessment.status, "QUOTED");
  assert.equal(result.assessment.routeMode, "LOCAL_DIRECT");
  assert.equal(result.quote.totalCustomerChargeMinor, "1200");
  assert.equal(result.quote.platformChargeMinor, "200");
  assert.equal("driverPayoutMinor" in result.quote, false);
  assert.equal("inputSnapshot" in result.quote, false);
  assert.equal(calls.quoteCreate.length, 1);
  assert.equal(calls.quoteCreate[0].inputSnapshot.driverPayoutMinor, "700");
  assert.equal(calls.quoteCreate[0].inputSnapshot.packageRateSnapshot[0].rateVersion, 3);
  assert.equal(calls.bookingUpdate.length, 1);
});

test("uses the requested validated quote expiry window", async () => {
  const { service, calls } = createHarness({ rates: [platformRate] });
  const result = await service.createQuote({ bookingId: "booking-1", userId: "sender-1", expiresInMinutes: 30 });

  assert.equal(result.quote.expiresAt.toISOString(), "2026-11-10T12:30:00.000Z");
  assert.equal(calls.quoteCreate[0].expiresAt.toISOString(), "2026-11-10T12:30:00.000Z");
});

test("does not estimate missing package weight or create a quote", async () => {
  const record = booking({ parcelPackages: [{ ...booking().parcelPackages[0], weightGrams: null }] });
  const { service, calls } = createHarness({ bookingRecord: record, rates: [platformRate] });
  const result = await service.createQuote({ bookingId: "booking-1", userId: "sender-1" });

  assert.equal(result.assessment.status, "REQUIRES_MEASUREMENT");
  assert.equal(result.quote, null);
  assert.equal(calls.quoteCreate.length, 0);
});

test("fails closed when the directed corridor has no active approval", async () => {
  const { service, calls } = createHarness({ availability: false, rates: [platformRate] });
  const result = await service.createQuote({ bookingId: "booking-1", userId: "sender-1" });

  assert.equal(result.assessment.status, "REQUIRES_OPERATIONAL_PRICING");
  assert.equal(result.quote, null);
  assert.equal(calls.quoteCreate.length, 0);
});

test("does not disclose or quote another sender's booking", async () => {
  const { service, calls } = createHarness({ bookingRecord: booking({ senderId: "different-sender" }), rates: [platformRate] });
  const result = await service.createQuote({ bookingId: "booking-1", userId: "sender-1" });

  assert.equal(result.forbidden, true);
  assert.equal(calls.quoteCreate.length, 0);
});

test("requires a draft booking and package facts before quote assessment", async () => {
  const { service, calls } = createHarness({ bookingRecord: booking({ status: "MATCHING" }) });
  const result = await service.createQuote({ bookingId: "booking-1", userId: "sender-1" });

  assert.equal(result.conflict.code, "BOOKING_NOT_QUOTABLE");
  assert.equal(calls.quoteCreate.length, 0);
});

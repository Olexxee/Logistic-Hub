import test from "node:test";
import assert from "node:assert/strict";
import { validateCreateCustomerQuote } from "../src/modules/parcels/parcel-bookings.validators.js";
import { createCustomerShipmentQuotesService } from "../src/modules/parcels/customer-shipment-quotes.service.js";

function validate(body) {
  const req = { body };
  let error = null;
  validateCreateCustomerQuote(req, null, value => { error = value ?? null; });
  return { req, error };
}

test("customer quote request defaults expiry to 15 minutes", () => {
  const { req, error } = validate({});
  assert.equal(error, null);
  assert.deepEqual(req.validated.body, { expiresInMinutes: 15 });
});

test("customer quote request accepts the documented expiry boundaries", () => {
  for (const expiresInMinutes of [5, 1440]) {
    const { req, error } = validate({ expiresInMinutes });
    assert.equal(error, null);
    assert.equal(req.validated.body.expiresInMinutes, expiresInMinutes);
  }
});

test("customer quote request rejects out-of-range, fractional and unknown fields", () => {
  for (const body of [
    { expiresInMinutes: 4 },
    { expiresInMinutes: 1441 },
    { expiresInMinutes: 15.5 },
    { expiresInMinutes: "15" },
    { expiresInMinutes: 15, totalCustomerChargeMinor: "1" },
  ]) {
    const { error } = validate(body);
    assert.ok(error, JSON.stringify(body));
  }
});

test("repeated acceptance by the owner replays the accepted quote and persisted delivery plan", async () => {
  const acceptedAt = new Date("2026-11-10T12:01:00.000Z");
  const pricingSnapshot = {
    quoteId: "quote-1",
    routeSnapshot: { routeMode: "LOCAL_DIRECT", originHub: null, destinationHub: null },
    totalCustomerChargeMinor: "1200",
  };
  const booking = {
    id: "booking-1",
    senderId: "sender-1",
    status: "AWAITING_PAYMENT",
    paymentStatus: "PENDING",
    currency: "NGN",
    publicReference: "LH-001",
    customerPayableMinor: 1200n,
    pricingSnapshot,
    parcelPackages: [],
  };
  const quote = {
    id: "quote-1",
    parcelBookingId: "booking-1",
    version: 1,
    status: "ACCEPTED",
    currency: "NGN",
    transportChargeMinor: 1000n,
    collectionChargeMinor: 0n,
    hubHandlingChargeMinor: 0n,
    destinationDeliveryChargeMinor: 0n,
    platformChargeMinor: 200n,
    otherChargesMinor: 0n,
    totalCustomerChargeMinor: 1200n,
    chargeBreakdown: {},
    expiresAt: new Date("2026-11-10T12:15:00.000Z"),
    offeredAt: new Date("2026-11-10T12:00:00.000Z"),
    acceptedAt,
    parcelBooking: booking,
  };
  const persistedLeg = {
    id: "leg-1",
    sequence: 1,
    type: "LOCAL_PICKUP",
    status: "READY_FOR_ASSIGNMENT",
    originServiceZoneId: "zone-a",
    destinationServiceZoneId: "zone-b",
    originHubPointId: null,
    destinationHubPointId: null,
  };
  const prismaClient = {
    $transaction: async work => work({
      shipmentQuote: { findFirst: async () => quote },
      deliveryLeg: {
        findMany: async args => {
          assert.deepEqual(args.where, { parcelBookingId: "booking-1" });
          return [persistedLeg];
        },
      },
    }),
  };
  const service = createCustomerShipmentQuotesService({
    prismaClient,
    clock: () => new Date("2026-11-10T12:02:00.000Z"),
  });

  const result = await service.acceptQuote({
    bookingId: "booking-1",
    quoteId: "quote-1",
    userId: "sender-1",
  });

  assert.equal(result.quote.status, "ACCEPTED");
  assert.equal(result.booking.status, "AWAITING_PAYMENT");
  assert.equal(result.booking.customerPayableMinor, "1200");
  assert.equal(result.deliveryPlan.routeMode, "LOCAL_DIRECT");
  assert.deepEqual(result.deliveryPlan.legs, [persistedLeg]);
});

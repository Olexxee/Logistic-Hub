import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerShipmentQuotesService } from "../src/modules/parcels/customer-shipment-quotes.service.js";

const now = new Date("2026-11-13T12:00:00.000Z");
const booking = {
  id: "booking-hub-1",
  publicReference: "LH-HUB-1",
  senderId: "sender-1",
  status: "DRAFT",
  paymentStatus: "INITIALIZED",
  currency: "NGN",
  pickupServiceZoneId: "zone-a",
  destinationServiceZoneId: "zone-b",
  pickupLatitude: 7.4,
  pickupLongitude: 4.2,
  destinationLatitude: 7.5,
  destinationLongitude: 4.3,
  parcelPackages: [{
    id: "package-1", packageSequence: 1, externalPackageRef: null,
    packageCategory: "DOCUMENT", weightGrams: 1500,
    lengthMm: 100, widthMm: 100, heightMm: 100,
  }],
  pricingSnapshot: null,
};

const hubs = [
  {
    id: "hub-a", name: "Origin Hub", serviceZoneId: "zone-a",
    latitude: 7.41, longitude: 4.21, status: "ACTIVE",
    operatorVerificationStatus: "VERIFIED", acceptedParcelTypes: ["DOCUMENT"],
    capacityConfig: { maxParcels: 10 },
  },
  {
    id: "hub-b", name: "Destination Hub", serviceZoneId: "zone-b",
    latitude: 7.49, longitude: 4.29, status: "ACTIVE",
    operatorVerificationStatus: "VERIFIED", acceptedParcelTypes: ["DOCUMENT"],
    capacityConfig: { maxParcels: 10 },
  },
];

function tariff(scope, legType, locator, id, charge) {
  return {
    id, version: 1, scope, legType, operationType: null, status: "ACTIVE",
    serviceZoneId: locator.serviceZoneId ?? null,
    originHubPointId: locator.originHubPointId ?? null,
    destinationHubPointId: locator.destinationHubPointId ?? null,
    hubPointId: null, parcelCategory: "DOCUMENT",
    minWeightGrams: 1001, maxWeightGrams: 3000,
    maxLengthMm: null, maxWidthMm: null, maxHeightMm: null,
    currency: "NGN", customerChargeMinor: BigInt(charge),
    platformChargeMinor: 100n,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
  };
}

function makeHarness({ missingScope = null } = {}) {
  const tariffs = [
    tariff("LOCAL_ZONE", "LOCAL_PICKUP", { serviceZoneId: "zone-a" }, "pickup", 1000),
    tariff("HUB_PAIR", "INTERSTATE_TRANSPORT", { originHubPointId: "hub-a", destinationHubPointId: "hub-b" }, "linehaul", 2000),
    tariff("LOCAL_ZONE", "FINAL_MILE", { serviceZoneId: "zone-b" }, "final", 3000),
  ];
  const bookingRecord = {
    ...booking,
    parcelPackages: booking.parcelPackages.map(pkg => ({ ...pkg })),
    pricingSnapshot: null,
  };
  const hubRecords = hubs.map(hub => ({ ...hub }));
  const calls = { quoteCreate: [], quoteUpdate: [], bookingUpdate: [], deliveryLegCreate: [], bookingEvents: [] };
  let storedQuote = null;
  const tx = {
    parcelBooking: {
      findUnique: async () => bookingRecord,
      updateMany: async args => {
        calls.bookingUpdate.push(args);
        Object.assign(bookingRecord, args.data);
        return { count: 1 };
      },
    },
    serviceZone: {
      findMany: async () => [
        { id: "zone-a", code: "A", name: "Zone A", stateId: "state-a" },
        { id: "zone-b", code: "B", name: "Zone B", stateId: "state-b" },
      ],
    },
    hubPoint: { findMany: async () => hubRecords },
    platformOperationalTariffAvailability: {
      findFirst: async ({ where }) => missingScope === where.scope
        ? null : { isEnabled: true, startsAt: null, endsAt: null },
    },
    platformOperationalTariff: {
      findMany: async ({ where }) => tariffs.filter(item =>
        item.scope === where.scope && item.legType === where.legType
        && item.serviceZoneId === where.serviceZoneId
        && item.originHubPointId === where.originHubPointId
        && item.destinationHubPointId === where.destinationHubPointId
        && where.parcelCategory.in.includes(item.parcelCategory)
        && item.currency === where.currency && item.status === "ACTIVE"
        && item.effectiveFrom <= now),
    },
    shipmentQuote: {
      findFirst: async args => args.include?.parcelBooking
        ? (storedQuote ? { ...storedQuote, parcelBooking: bookingRecord } : null)
        : null,
      updateMany: async args => {
        calls.quoteUpdate.push(args);
        if (storedQuote && storedQuote.id === args.where.id && storedQuote.status === args.where.status) {
          Object.assign(storedQuote, args.data);
          return { count: 1 };
        }
        return { count: 0 };
      },
      create: async ({ data }) => {
        calls.quoteCreate.push(data);
        storedQuote = {
          id: "quote-hub-1", parcelBookingId: data.parcelBookingId,
          version: data.version, status: data.status, currency: data.currency,
          ...data, offeredAt: now, acceptedAt: null,
        };
        return storedQuote;
      },
    },
    deliveryLeg: {
      findMany: async () => calls.deliveryLegCreate.map((data, index) => ({
        id: `delivery-leg-${index + 1}`, sequence: data.sequence, type: data.type,
        status: data.status, originServiceZoneId: data.originServiceZoneId,
        destinationServiceZoneId: data.destinationServiceZoneId,
        originHubPointId: data.originHubPointId, destinationHubPointId: data.destinationHubPointId,
      })),
      create: async ({ data }) => {
        calls.deliveryLegCreate.push(data);
        return {
          id: `delivery-leg-${data.sequence}`, sequence: data.sequence,
          type: data.type, status: data.status,
          originServiceZoneId: data.originServiceZoneId,
          destinationServiceZoneId: data.destinationServiceZoneId,
          originHubPointId: data.originHubPointId,
          destinationHubPointId: data.destinationHubPointId,
        };
      },
    },
    bookingEvent: {
      create: async ({ data }) => { calls.bookingEvents.push(data); return data; },
    },
  };
  const prismaClient = { $transaction: async work => work(tx) };
  return {
    service: createCustomerShipmentQuotesService({ prismaClient, clock: () => now }),
    calls, tariffs, hubRecords, bookingRecord, get storedQuote() { return storedQuote; },
  };
}

test("issues a customer quote from pickup, directed hub-pair and final-mile tariffs", async () => {
  const { service, calls } = makeHarness();
  const result = await service.createQuote({ bookingId: booking.id, userId: booking.senderId });

  assert.equal(result.assessment.status, "QUOTED");
  assert.equal(result.assessment.source, "PLATFORM_OPERATIONAL_TARIFF");
  assert.equal(result.assessment.routeMode, "HUB_ASSISTED");
  assert.equal(result.quote.transportChargeMinor, "6000");
  assert.equal(result.quote.platformChargeMinor, "300");
  assert.equal(result.quote.totalCustomerChargeMinor, "6300");
  assert.equal(calls.quoteCreate.length, 1);
  assert.equal(calls.quoteCreate[0].inputSnapshot.source, "PLATFORM_OPERATIONAL_TARIFF");
  assert.deepEqual(
    calls.quoteCreate[0].inputSnapshot.operationalTariffAssessment.legs.map(leg => leg.type),
    ["LOCAL_PICKUP", "INTERSTATE_TRANSPORT", "FINAL_MILE"],
  );
  assert.equal(calls.quoteCreate[0].chargeBreakdown.operationalLegCharges.length, 3);
  assert.equal("tariff" in calls.quoteCreate[0].chargeBreakdown.operationalLegCharges[0].packages[0], false);
  assert.equal(calls.quoteCreate[0].chargeBreakdown.operationalLegCharges[0].packages[0].customerChargeMinor, "1000");
});

test("does not issue a quote when exact-scope operational availability is missing", async () => {
  const { service, calls } = makeHarness({ missingScope: "HUB_PAIR" });
  const result = await service.createQuote({ bookingId: booking.id, userId: booking.senderId });
  assert.equal(result.assessment.status, "NO_COVERAGE");
  assert.equal(result.quote, null);
  assert.equal(calls.quoteCreate.length, 0);
});

test("accepts an unchanged operational quote and flags each leg for execution review", async () => {
  const { service, calls } = makeHarness();
  const issued = await service.createQuote({ bookingId: booking.id, userId: booking.senderId });
  const accepted = await service.acceptQuote({
    bookingId: booking.id, quoteId: issued.quote.id, userId: booking.senderId,
  });

  assert.equal(accepted.booking.status, "AWAITING_PARTNER_ASSIGNMENT");
  assert.equal(accepted.booking.customerPayableMinor, "6300");
  assert.equal(accepted.deliveryPlan.routeMode, "HUB_ASSISTED");
  assert.equal(accepted.deliveryPlan.legs.length, 3);
  assert.ok(calls.deliveryLegCreate.every(leg => leg.status === "PLANNED"));
  assert.ok(calls.deliveryLegCreate.every(leg => leg.metadata.requiresOperationalReview === true));
  assert.ok(calls.deliveryLegCreate.every(leg => leg.metadata.executionReadiness === "NOT_ASSESSED"));
  assert.equal(calls.bookingEvents.length, 1);
  assert.equal(accepted.booking.pricingSnapshot.executionReadiness.status, "NOT_ASSESSED");
  assert.equal(Object.hasOwn(accepted.booking.pricingSnapshot, "driverPayoutMinor"), false);
  assert.equal(Object.hasOwn(accepted.booking.pricingSnapshot, "partnerExecutionCostMinor"), false);
});

test("rejects acceptance when an operational tariff changes after quote issuance", async () => {
  const { service, tariffs, calls } = makeHarness();
  const issued = await service.createQuote({ bookingId: booking.id, userId: booking.senderId });
  tariffs.find(item => item.id === "linehaul").customerChargeMinor = 2500n;

  const accepted = await service.acceptQuote({
    bookingId: booking.id, quoteId: issued.quote.id, userId: booking.senderId,
  });
  assert.equal(accepted.conflict.code, "OPERATIONAL_TARIFF_CHANGED");
  assert.equal(calls.deliveryLegCreate.length, 0);
});


test("rejects acceptance when the resolved hub route changes after quote issuance", async () => {
  const { service, hubRecords, calls } = makeHarness();
  const issued = await service.createQuote({ bookingId: booking.id, userId: booking.senderId });
  hubRecords.splice(0, hubRecords.length);

  const accepted = await service.acceptQuote({
    bookingId: booking.id, quoteId: issued.quote.id, userId: booking.senderId,
  });
  assert.equal(accepted.conflict.code, "OPERATIONAL_ROUTE_CHANGED");
  assert.equal(calls.deliveryLegCreate.length, 0);
});

test("does not accept an operational quote after its expiry", async () => {
  const { service, calls } = makeHarness();
  const issued = await service.createQuote({
    bookingId: booking.id, userId: booking.senderId, expiresInMinutes: 0,
  });
  const accepted = await service.acceptQuote({
    bookingId: booking.id, quoteId: issued.quote.id, userId: booking.senderId,
  });
  assert.equal(accepted.conflict.code, "QUOTE_NOT_ACTIVE");
  assert.equal(calls.deliveryLegCreate.length, 0);
});

test("acceptance replay returns the existing delivery plan without duplicating legs", async () => {
  const { service, calls } = makeHarness();
  const issued = await service.createQuote({ bookingId: booking.id, userId: booking.senderId });
  const first = await service.acceptQuote({
    bookingId: booking.id, quoteId: issued.quote.id, userId: booking.senderId,
  });
  const second = await service.acceptQuote({
    bookingId: booking.id, quoteId: issued.quote.id, userId: booking.senderId,
  });
  assert.equal(first.quote.status, "ACCEPTED");
  assert.equal(second.quote.status, "ACCEPTED");
  assert.equal(second.deliveryPlan.legs.length, 3);
  assert.equal(calls.deliveryLegCreate.length, 3);
  assert.equal(calls.bookingEvents.length, 1);
});

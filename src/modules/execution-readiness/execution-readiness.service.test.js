import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionReadinessService } from "./execution-readiness.service.js";

const now = new Date("2026-11-13T18:00:00.000Z");
const packageFacts = [{
  id: "package-1",
  packageSequence: 1,
  packageCategory: "GENERAL",
  weightGrams: 500,
  lengthMm: 100,
  widthMm: 100,
  heightMm: 100,
}];

function hub(id, serviceZoneId, overrides = {}) {
  return {
    id,
    status: "ACTIVE",
    operatorVerificationStatus: "VERIFIED",
    serviceZoneId,
    acceptedParcelTypes: ["GENERAL"],
    capacityConfig: { maxParcels: 10 },
    serviceZone: {
      id: serviceZoneId,
      isActive: true,
      state: { isActive: true, country: { isActive: true } },
      availability: [{ id: "availability-1" }],
    },
    ...overrides,
  };
}

function baseLeg(overrides = {}) {
  const routeLeg = {
    sequence: 1,
    type: "LOCAL_PICKUP",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-1",
    originHubPointId: null,
    destinationHubPointId: "hub-1",
  };
  const acceptedQuote = {
    id: "quote-1",
    status: "ACCEPTED",
    currency: "NGN",
    inputSnapshot: {
      source: "PLATFORM_OPERATIONAL_TARIFF",
      routeSnapshot: { legs: [routeLeg] },
    },
    acceptedAt: now,
  };
  return {
    id: "leg-1",
    sequence: 1,
    type: "LOCAL_PICKUP",
    status: "PLANNED",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-1",
    originHubPointId: null,
    destinationHubPointId: "hub-1",
    originLatitude: 6.5244,
    originLongitude: 3.3792,
    metadata: {
      quoteId: "quote-1",
      pricingSource: "PLATFORM_OPERATIONAL_TARIFF",
      requiresOperationalReview: true,
      executionReadiness: "NOT_ASSESSED",
    },
    parcelBooking: {
      id: "booking-1",
      paymentStatus: "SUCCEEDED",
      currency: "NGN",
      integrationClientId: null,
      integrationDispatchAuthorizedAt: null,
      parcelPackages: packageFacts,
      quotes: [acceptedQuote],
    },
    ...overrides,
  };
}

function driver(overrides = {}) {
  return {
    id: "driver-1",
    serviceRadiusMeters: 5000,
    lastLocationAt: now,
    locations: [{
      latitude: 6.5244,
      longitude: 3.3792,
      recordedAt: now,
    }],
    ...overrides,
  };
}

function setup({ leg = baseLeg(), drivers = [driver()], rules, partnerRates = [], hubs = {} } = {}) {
  const tx = {
    platformDriverPayoutRule: { findMany: async () => rules ?? [{
      id: "payout-rule-1",
      version: 2,
      serviceZoneId: "zone-1",
      legType: "LOCAL_PICKUP",
      parcelCategory: "GENERAL",
      minWeightGrams: 0,
      maxWeightGrams: 1000,
      currency: "NGN",
      driverPayoutMinor: 25000n,
      effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
      effectiveUntil: null,
      status: "ACTIVE",
    }] },
  };
  const repository = {
    findLeg: async () => leg,
    findActiveServiceZones: async (_tx, ids) => ids.map(id => ({ id })),
    findActiveHub: async (_tx, id) => hubs[id] ?? hub(id, id === "hub-2" ? "zone-2" : "zone-1"),
    getHubLoad: async () => ({
      load: { _count: { _all: 0 }, _sum: { weightGrams: 0, volumeCm3: 0 } },
      missingVolumeCount: 0,
    }),
    findEligibleLocalDrivers: async () => drivers,
    findPartnerRates: async () => partnerRates,
  };
  const prismaClient = {
    $transaction: callback => callback(tx),
    deliveryLeg: { findMany: async () => [{ id: leg.id, sequence: leg.sequence }] },
  };
  return createExecutionReadinessService({ prismaClient, repository, clock: () => now });
}

test("local pickup is ready only with a matching payout rule, eligible driver and receiving-hub capacity", async () => {
  const service = setup();
  const result = await service.assessLeg({ deliveryLegId: "leg-1" });
  assert.equal(result.readiness, "READY");
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.execution.mode, "PLATFORM_DRIVER");
  assert.equal(result.execution.payoutAssessment.totalDriverPayoutMinor, "25000");
  assert.equal(result.execution.eligibleDriverCount, 1);
});

test("blocks a local leg when no driver passes existing eligibility and pickup-radius checks", async () => {
  const service = setup({ drivers: [] });
  const result = await service.assessLeg({ deliveryLegId: "leg-1" });
  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "NO_ELIGIBLE_LOCAL_DRIVER"));
});

test("blocks when the receiving hub has insufficient parcel capacity", async () => {
  const service = setup({
    hubs: { "hub-1": hub("hub-1", "zone-1", { capacityConfig: { maxParcels: 1 } }) },
  });
  const result = await service.assessLeg({ deliveryLegId: "leg-1" });
  assert.equal(result.readiness, "READY");
  // One package fits a one-parcel capacity; the second package does not.
  const twoPackages = baseLeg({
    parcelBooking: {
      ...baseLeg().parcelBooking,
      parcelPackages: [...packageFacts, { ...packageFacts[0], id: "package-2", packageSequence: 2, packageCategory: "FRAGILE" }],
    },
  });
  const blocked = await setup({
    leg: twoPackages,
    hubs: { "hub-1": hub("hub-1", "zone-1", { capacityConfig: { maxParcels: 1 } }) },
  }).assessLeg({ deliveryLegId: "leg-1" });
  assert.ok(blocked.blockers.some(item => item.code === "HUB_PARCEL_CAPACITY_EXCEEDED"));
});

test("partner leg resolves a single rate-card candidate covering every package", async () => {
  const partnerLeg = baseLeg({
    type: "INTERSTATE_TRANSPORT",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    originHubPointId: "hub-1",
    destinationHubPointId: "hub-2",
    metadata: { quoteId: "quote-1", pricingSource: "PLATFORM_OPERATIONAL_TARIFF", requiresOperationalReview: true },
    parcelBooking: {
      ...baseLeg().parcelBooking,
      quotes: [{
        ...baseLeg().parcelBooking.quotes[0],
        inputSnapshot: {
          source: "PLATFORM_OPERATIONAL_TARIFF",
          routeSnapshot: { legs: [{
            sequence: 1, type: "INTERSTATE_TRANSPORT",
            originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-2",
            originHubPointId: "hub-1", destinationHubPointId: "hub-2",
          }] },
        },
      }],
    },
  });
  const rate = {
    id: "partner-rate-1",
    rateCardId: "card-1",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    serviceType: "PARCEL_DELIVERY",
    parcelCategory: "GENERAL",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    maxLengthMm: null, maxWidthMm: null, maxHeightMm: null,
    transportChargeMinor: 18000n,
    estimatedTransitMinutes: 120,
    rateCard: {
      id: "card-1", version: 4, agreementId: "agreement-1",
      agreement: {
        id: "agreement-1", reference: "AGR-001",
        partner: { id: "partner-1", displayName: "Verified Partner" },
      },
    },
  };
  const result = await setup({
    leg: partnerLeg,
    partnerRates: [rate],
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-2": hub("hub-2", "zone-2"),
    },
  }).assessLeg({ deliveryLegId: "leg-1" });
  assert.equal(result.readiness, "READY");
  assert.equal(result.execution.mode, "TRANSPORT_PARTNER");
  assert.equal(result.execution.partnerCandidates[0].totalExecutionCostMinor, "18000");
  assert.equal(result.execution.partnerCandidates[0].rateCardVersion, 4);
});

test("blocks partner execution when no single rate card covers all packages", async () => {
  const partnerLeg = baseLeg({
    type: "INTERSTATE_TRANSPORT",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    originHubPointId: "hub-1",
    destinationHubPointId: "hub-2",
    metadata: { quoteId: "quote-1", pricingSource: "PLATFORM_OPERATIONAL_TARIFF", requiresOperationalReview: true },
    parcelBooking: {
      ...baseLeg().parcelBooking,
      parcelPackages: [...packageFacts, { ...packageFacts[0], id: "package-2", packageSequence: 2 }],
      quotes: [{
        ...baseLeg().parcelBooking.quotes[0],
        inputSnapshot: { source: "PLATFORM_OPERATIONAL_TARIFF", routeSnapshot: { legs: [{
          sequence: 1, type: "INTERSTATE_TRANSPORT", originServiceZoneId: "zone-1",
          destinationServiceZoneId: "zone-2", originHubPointId: "hub-1", destinationHubPointId: "hub-2",
        }] } },
      }],
    },
  });
  const onlyOnePackageRate = {
    id: "partner-rate-1", rateCardId: "card-1", parcelCategory: "GENERAL",
    minWeightGrams: 0, maxWeightGrams: 1000,
    maxLengthMm: null, maxWidthMm: null, maxHeightMm: null,
    transportChargeMinor: 18000n,
    rateCard: { id: "card-1", version: 1, agreementId: "agreement-1", agreement: {
      id: "agreement-1", reference: "AGR-001", partner: { id: "partner-1", displayName: "Partner" },
    } },
  };
  const result = await setup({
    leg: partnerLeg,
    partnerRates: [onlyOnePackageRate],
    hubs: { "hub-1": hub("hub-1", "zone-1"), "hub-2": hub("hub-2", "zone-2") },
  }).assessLeg({ deliveryLegId: "leg-1" });
  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "NO_PARTNER_EXECUTION_RATE"));
});

test("blocks a leg whose accepted quote route topology no longer matches", async () => {
  const leg = baseLeg();
  leg.parcelBooking.quotes[0].inputSnapshot.routeSnapshot.legs[0].destinationHubPointId = "different-hub";
  const result = await setup({ leg }).assessLeg({ deliveryLegId: "leg-1" });
  assert.ok(result.blockers.some(item => item.code === "ACCEPTED_ROUTE_SNAPSHOT_MISMATCH"));
  assert.equal(result.dispatchAuthorized, false);
});

test("requires payment and integration dispatch release before readiness", async () => {
  const leg = baseLeg({
    parcelBooking: {
      ...baseLeg().parcelBooking,
      paymentStatus: "PENDING",
      integrationClientId: "client-1",
      integrationDispatchAuthorizedAt: null,
    },
  });
  const result = await setup({ leg }).assessLeg({ deliveryLegId: "leg-1" });
  assert.ok(result.blockers.some(item => item.code === "BOOKING_NOT_PAID"));
  assert.ok(result.blockers.some(item => item.code === "INTEGRATION_DISPATCH_REVIEW_PENDING"));
});

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
    origin: { latitude: 6.5244, longitude: 3.3792 },
    destination: { latitude: 6.525, longitude: 3.38 },
  };
  const acceptedQuote = {
    id: "quote-1",
    status: "ACCEPTED",
    currency: "NGN",
    inputSnapshot: {
      source: "PLATFORM_OPERATIONAL_TARIFF",
      routeSnapshot: { legs: [routeLeg] },
      operationalTariffAssessment: {
        legs: [{
          sequence: 1,
          type: "LOCAL_PICKUP",
          packages: packageFacts.map((pkg, index) => ({
            packageId: pkg.id,
            packageSequence: index + 1,
            packageCategory: pkg.packageCategory,
            weightGrams: pkg.weightGrams,
            dimensionsMm: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
          })),
        }],
      },
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
    destinationLatitude: 6.525,
    destinationLongitude: 3.38,
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

function setup({
  leg = baseLeg(), drivers = [driver()], rules, partnerRates = [], hubs = {},
  previousLeg = null, recoveryDisposition = null,
} = {}) {
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
    findPreviousLeg: async () => previousLeg,
    findRecoveryDisposition: async () => recoveryDisposition,
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

function recoveryContinuationFixture(overrides = {}) {
  const leg = baseLeg({
    id: "leg-2",
    sequence: 2,
    type: "INTERSTATE_TRANSPORT",
    status: "PLANNED",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    originHubPointId: "hub-1",
    destinationHubPointId: "hub-2",
    originLatitude: 6.5244,
    originLongitude: 3.3792,
    destinationLatitude: 7.1475,
    destinationLongitude: 3.3619,
    metadata: {
      source: "DRV-05C-D2_HUB_RECOVERY",
      sourceIntakeRecordId: "intake-1",
      sourceDeliveryLegId: "leg-1",
      sourceQuoteId: "quote-1",
      hubRecoveryId: "hub-recovery-1",
    },
    parcelBooking: {
      ...baseLeg().parcelBooking,
      status: "IN_TRANSIT",
    },
  });
  const disposition = {
    id: "disposition-1",
    intakeRecordId: "intake-1",
    hubRecoveryId: "hub-recovery-1",
    parcelBookingId: "booking-1",
    sourceDeliveryLegId: "leg-1",
    hubPointId: "hub-1",
    decision: "CONTINUE_DELIVERY",
    status: "ROUTE_APPROVED",
    destinationServiceZoneId: "zone-2",
    destinationHubPointId: "hub-2",
    nextDeliveryLegId: "leg-2",
    intakeRecord: {
      id: "intake-1", status: "RECEIVED", parcelBookingId: "booking-1",
      deliveryLegId: "leg-1", hubPointId: "hub-1",
    },
    hubRecovery: {
      id: "hub-recovery-1", status: "CONFIRMED", parcelBookingId: "booking-1",
      deliveryLegId: "leg-1", hubPointId: "hub-1", hubIntakeRecordId: "intake-1",
    },
    sourceDeliveryLeg: {
      id: "leg-1", parcelBookingId: "booking-1", sequence: 1,
      status: "FAILED", failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED",
      metadata: { quoteId: "quote-1" },
    },
    hubPoint: { id: "hub-1", serviceZoneId: "zone-1", latitude: 6.5244, longitude: 3.3792 },
    destinationHubPoint: { id: "hub-2", serviceZoneId: "zone-2", latitude: 7.1475, longitude: 3.3619 },
    ...overrides,
  };
  return {
    leg,
    disposition,
    previousLeg: {
      id: "leg-1", sequence: 1, type: "INTERSTATE_TRANSPORT",
      status: "FAILED", completedAt: null,
      failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED",
    },
  };
}

test("approved hub-recovery continuation bypasses only its exact failed source predecessor and resolves partner rates", async () => {
  const fixture = recoveryContinuationFixture();
  const partnerRate = {
    id: "recovery-partner-rate",
    rateCardId: "recovery-rate-card",
    parcelCategory: "GENERAL",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    maxLengthMm: null,
    maxWidthMm: null,
    maxHeightMm: null,
    transportChargeMinor: 21000n,
    estimatedTransitMinutes: 180,
    rateCard: {
      id: "recovery-rate-card",
      version: 3,
      agreementId: "recovery-agreement",
      agreement: {
        id: "recovery-agreement",
        reference: "RECOVERY-AGR-001",
        partner: { id: "recovery-partner", displayName: "Recovery Partner" },
      },
    },
  };
  const result = await setup({
    ...fixture,
    partnerRates: [partnerRate],
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-2": hub("hub-2", "zone-2"),
    },
    recoveryDisposition: fixture.disposition,
  }).assessLeg({ deliveryLegId: "leg-2" });

  assert.equal(result.readiness, "READY");
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.legType, "INTERSTATE_TRANSPORT");
  assert.deepEqual(result.recovery, {
    dispositionId: "disposition-1",
    intakeRecordId: "intake-1",
    hubRecoveryId: "hub-recovery-1",
    sourceDeliveryLegId: "leg-1",
  });
  assert.equal(result.execution.mode, "TRANSPORT_PARTNER");
  assert.equal(result.execution.partnerCandidates[0].totalExecutionCostMinor, "21000");
  assert.equal(result.blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"), false);
});

test("same-state hub recovery continuation resolves HUB_TRANSFER partner execution rates", async () => {
  const fixture = recoveryContinuationFixture();
  fixture.leg.type = "HUB_TRANSFER";
  fixture.leg.destinationServiceZoneId = "zone-1";
  fixture.leg.destinationHubPointId = "hub-3";
  fixture.leg.destinationLatitude = 6.53;
  fixture.leg.destinationLongitude = 3.39;
  fixture.disposition.destinationServiceZoneId = "zone-1";
  fixture.disposition.destinationHubPointId = "hub-3";
  fixture.disposition.destinationHubPoint = {
    id: "hub-3", serviceZoneId: "zone-1", latitude: 6.53, longitude: 3.39,
  };
  const rate = {
    id: "hub-transfer-rate",
    rateCardId: "hub-transfer-card",
    parcelCategory: "GENERAL",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    maxLengthMm: null, maxWidthMm: null, maxHeightMm: null,
    transportChargeMinor: 12000n,
    estimatedTransitMinutes: 60,
    rateCard: {
      id: "hub-transfer-card", version: 2, agreementId: "hub-transfer-agreement",
      agreement: {
        id: "hub-transfer-agreement", reference: "HUB-TRANSFER-AGR",
        partner: { id: "hub-transfer-partner", displayName: "Local Hub Transfer Partner" },
      },
    },
  };
  const result = await setup({
    ...fixture,
    recoveryDisposition: fixture.disposition,
    partnerRates: [rate],
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-3": hub("hub-3", "zone-1"),
    },
  }).assessLeg({ deliveryLegId: "leg-2" });

  assert.equal(result.readiness, "READY");
  assert.equal(result.legType, "HUB_TRANSFER");
  assert.equal(result.execution.mode, "TRANSPORT_PARTNER");
  assert.equal(result.execution.partnerCandidates[0].totalExecutionCostMinor, "12000");
});

test("recovery metadata without a persisted approved disposition cannot bypass predecessor gating", async () => {
  const fixture = recoveryContinuationFixture();
  const result = await setup({
    ...fixture,
    recoveryDisposition: null,
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-2": hub("hub-2", "zone-2"),
    },
  }).assessLeg({ deliveryLegId: "leg-2" });

  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "RECOVERY_DISPOSITION_NOT_FOUND"));
  assert.ok(result.blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"));
});

test("released or mismatched hub disposition cannot authorize a recovery continuation", async () => {
  const fixture = recoveryContinuationFixture({ status: "RELEASED" });
  const result = await setup({
    ...fixture,
    recoveryDisposition: fixture.disposition,
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-2": hub("hub-2", "zone-2"),
    },
  }).assessLeg({ deliveryLegId: "leg-2" });

  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "RECOVERY_DISPOSITION_MISMATCH"));
  assert.ok(result.blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"));
});

test("recovery continuation blocks when accepted quote package snapshots disagree across route legs", async () => {
  const fixture = recoveryContinuationFixture();
  fixture.leg.parcelBooking.quotes[0].inputSnapshot.operationalTariffAssessment.legs.push({
    sequence: 2,
    type: "INTERSTATE_TRANSPORT",
    packages: [{
      packageId: "package-1",
      packageSequence: 1,
      packageCategory: "GENERAL",
      weightGrams: 501,
      dimensionsMm: { length: 100, width: 100, height: 100 },
    }],
  });
  const result = await setup({
    ...fixture,
    recoveryDisposition: fixture.disposition,
    partnerRates: [],
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-2": hub("hub-2", "zone-2"),
    },
  }).assessLeg({ deliveryLegId: "leg-2" });

  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "PACKAGE_FACTS_CHANGED"));
});

test("recovery continuation cannot bypass the predecessor gate for an unrelated failed leg", async () => {
  const fixture = recoveryContinuationFixture();
  fixture.previousLeg.failureReason = "OTHER_FAILURE";
  const result = await setup({
    ...fixture,
    recoveryDisposition: fixture.disposition,
    hubs: {
      "hub-1": hub("hub-1", "zone-1"),
      "hub-2": hub("hub-2", "zone-2"),
    },
  }).assessLeg({ deliveryLegId: "leg-2" });

  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"));
});

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
          packageRateSnapshot: [{
            sequence: 1,
            type: "INTERSTATE_TRANSPORT",
            packages: packageFacts.map((pkg, index) => ({
              packageId: pkg.id,
              packageSequence: index + 1,
              packageCategory: pkg.packageCategory,
              weightGrams: pkg.weightGrams,
              dimensionsMm: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
            })),
          }],
          routeSnapshot: { legs: [{
            sequence: 1, type: "INTERSTATE_TRANSPORT",
            originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-2",
            originHubPointId: "hub-1", destinationHubPointId: "hub-2",
            origin: { latitude: 6.5244, longitude: 3.3792 },
            destination: { latitude: 6.525, longitude: 3.38 },
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
      parcelPackages: [...packageFacts, { ...packageFacts[0], id: "package-2", packageSequence: 2, packageCategory: "FRAGILE" }],
      quotes: [{
        ...baseLeg().parcelBooking.quotes[0],
        inputSnapshot: { source: "PLATFORM_OPERATIONAL_TARIFF", packageRateSnapshot: [{
          sequence: 1, type: "INTERSTATE_TRANSPORT",
          packages: [...packageFacts, { ...packageFacts[0], id: "package-2", packageSequence: 2, packageCategory: "FRAGILE" }].map((pkg, index) => ({
            packageId: pkg.id, packageSequence: index + 1, packageCategory: pkg.packageCategory,
            weightGrams: pkg.weightGrams,
            dimensionsMm: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
          })),
        }], routeSnapshot: { legs: [{
          sequence: 1, type: "INTERSTATE_TRANSPORT", originServiceZoneId: "zone-1",
          destinationServiceZoneId: "zone-2", originHubPointId: "hub-1", destinationHubPointId: "hub-2",
          origin: { latitude: 6.5244, longitude: 3.3792 },
          destination: { latitude: 6.525, longitude: 3.38 },
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


test("blocks when package measurements differ from the accepted quote snapshot", async () => {
  const leg = baseLeg();
  leg.parcelBooking.parcelPackages = [{ ...packageFacts[0], weightGrams: 700 }];
  const result = await setup({ leg }).assessLeg({ deliveryLegId: "leg-1" });
  assert.ok(result.blockers.some(item => item.code === "PACKAGE_FACTS_CHANGED"));
  assert.equal(result.readiness, "BLOCKED");
});

test("blocks when a referenced hub is suspended or its operator is unverified", async () => {
  const service = setup({
    hubs: {
      "hub-1": hub("hub-1", "zone-1", { status: "SUSPENDED" }),
    },
  });
  const result = await service.assessLeg({ deliveryLegId: "leg-1" });
  assert.ok(result.blockers.some(item => item.code === "HUB_NOT_OPERATIONAL"));
});


test("executor selection persists a versioned immutable driver payout snapshot and releases the leg", async () => {
  const leg = baseLeg();
  const selectedDriver = driver();
  const created = [];
  const tx = {
    platformDriverPayoutRule: {
      findMany: async () => [{
        id: "payout-rule-1", version: 2, serviceZoneId: "zone-1",
        legType: "LOCAL_PICKUP", parcelCategory: "GENERAL",
        minWeightGrams: 0, maxWeightGrams: 1000, currency: "NGN",
        driverPayoutMinor: 25000n, effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
        effectiveUntil: null, status: "ACTIVE",
      }],
    },
    deliveryLegOffer: { count: async () => 0 },
    driverAssignment: { count: async () => 0 },
    partnerDeliveryAssignment: { count: async () => 0 },
    deliveryLegExecutionSnapshot: {
      findUnique: async () => null,
      aggregate: async () => ({ _max: { version: null } }),
      create: async ({ data }) => {
        const snapshot = { id: "snapshot-1", ...data };
        created.push(snapshot);
        return snapshot;
      },
    },
    deliveryLeg: { updateMany: async () => ({ count: 1 }) },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  };
  const repository = {
    findLeg: async () => leg,
    findActiveServiceZones: async (_tx, ids) => ids.map(id => ({ id })),
    findActiveHub: async (_tx, id) => hub(id, "zone-1"),
    getHubLoad: async () => ({
      load: { _count: { _all: 0 }, _sum: { weightGrams: 0, volumeCm3: 0 } },
      missingVolumeCount: 0,
    }),
    findEligibleLocalDrivers: async () => [selectedDriver],
    findEligibleLocalDriver: async () => selectedDriver,
    findPartnerRates: async () => [],
  };
  const prismaClient = { $transaction: callback => callback(tx) };
  const service = createExecutionReadinessService({ prismaClient, repository, clock: () => now });
  const result = await service.selectExecutor({
    deliveryLegId: "leg-1",
    executorType: "PLATFORM_DRIVER",
    driverProfileId: "driver-1",
    vehicleId: "vehicle-1",
    selectedByUserId: "admin-1",
    idempotencyKey: "hat-driver-select-001",
  });

  assert.equal(result.replay, false);
  assert.equal(result.snapshot.executorType, "PLATFORM_DRIVER");
  assert.equal(result.snapshot.selectedDriverProfileId, "driver-1");
  assert.equal(result.snapshot.selectedVehicleId, "vehicle-1");
  assert.equal(result.snapshot.executionCostMinor, 25000n);
  assert.equal(result.snapshot.costSource, "PLATFORM_DRIVER_PAYOUT_RULE");
  assert.equal(result.snapshot.version, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].assessmentSnapshot.dispatchAuthorized, false);
});


test("executor selection serializes concurrent service requests and enforces idempotency payload identity", async () => {
  function concurrentHarness() {
    const leg = baseLeg();
    const selectedDriver = driver();
    const snapshots = new Map();
    let transactionTail = Promise.resolve();
    const tx = {
      platformDriverPayoutRule: {
        findMany: async () => [{
          id: "payout-rule-race", version: 2, serviceZoneId: "zone-1",
          legType: "LOCAL_PICKUP", parcelCategory: "GENERAL",
          minWeightGrams: 0, maxWeightGrams: 1000, currency: "NGN",
          driverPayoutMinor: 25000n, effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
          effectiveUntil: null, status: "ACTIVE",
        }],
      },
      deliveryLegOffer: { count: async () => 0 },
      driverAssignment: { count: async () => 0 },
      partnerDeliveryAssignment: { count: async () => 0 },
      deliveryLegExecutionSnapshot: {
        findUnique: async ({ where }) => snapshots.get(where.idempotencyKey) ?? null,
        aggregate: async () => ({
          _max: { version: Math.max(0, ...[...snapshots.values()].map(item => item.version)) },
        }),
        create: async ({ data }) => {
          const snapshot = { id: `snapshot-${data.version}`, ...data };
          snapshots.set(data.idempotencyKey, snapshot);
          return snapshot;
        },
      },
      deliveryLeg: {
        updateMany: async () => {
          leg.status = "READY_FOR_ASSIGNMENT";
          return { count: 1 };
        },
      },
      operationalAuditEvent: { create: async () => ({ id: "audit-race" }) },
    };
    const prismaClient = {
      $transaction: callback => {
        const transaction = transactionTail.then(() => callback(tx));
        transactionTail = transaction.catch(() => {});
        return transaction;
      },
    };
    const repository = {
      findLeg: async () => leg,
      findActiveServiceZones: async (_tx, ids) => ids.map(id => ({ id })),
      findActiveHub: async (_tx, id) => hub(id, "zone-1"),
      getHubLoad: async () => ({
        load: { _count: { _all: 0 }, _sum: { weightGrams: 0, volumeCm3: 0 } },
        missingVolumeCount: 0,
      }),
      findEligibleLocalDrivers: async () => [selectedDriver],
      findEligibleLocalDriver: async () => selectedDriver,
      findPartnerRates: async () => [],
    };
    return {
      service: createExecutionReadinessService({ prismaClient, repository, clock: () => now }),
      snapshots,
    };
  }

  const identical = concurrentHarness();
  const identicalResults = await Promise.all([
    identical.service.selectExecutor({
      deliveryLegId: "leg-1", executorType: "PLATFORM_DRIVER",
      driverProfileId: "driver-1", vehicleId: "vehicle-1",
      selectedByUserId: "admin-1", idempotencyKey: "race-identical-key",
    }),
    identical.service.selectExecutor({
      deliveryLegId: "leg-1", executorType: "PLATFORM_DRIVER",
      driverProfileId: "driver-1", vehicleId: "vehicle-1",
      selectedByUserId: "admin-2", idempotencyKey: "race-identical-key",
    }),
  ]);
  assert.deepEqual(identicalResults.map(result => result.replay).sort(), [false, true]);
  assert.equal(identical.snapshots.size, 1);
  assert.equal(identicalResults[0].snapshot.id, identicalResults[1].snapshot.id);

  const conflicting = concurrentHarness();
  const conflictingResults = await Promise.allSettled([
    conflicting.service.selectExecutor({
      deliveryLegId: "leg-1", executorType: "PLATFORM_DRIVER",
      driverProfileId: "driver-1", vehicleId: "vehicle-1",
      selectedByUserId: "admin-1", idempotencyKey: "race-conflicting-key",
    }),
    conflicting.service.selectExecutor({
      deliveryLegId: "leg-1", executorType: "PLATFORM_DRIVER",
      driverProfileId: "different-driver", vehicleId: "vehicle-1",
      selectedByUserId: "admin-2", idempotencyKey: "race-conflicting-key",
    }),
  ]);
  assert.equal(conflictingResults.filter(result => result.status === "fulfilled").length, 1);
  const rejected = conflictingResults.find(result => result.status === "rejected");
  assert.equal(rejected.reason.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(rejected.reason.statusCode, 409);
  assert.equal(conflicting.snapshots.size, 1);
});


test("blocks a later HAT leg until the immediately preceding leg is completed", async () => {
  const leg = baseLeg({ sequence: 2 });
  const result = await setup({
    leg,
    previousLeg: { id: "leg-1", sequence: 1, type: "LOCAL_PICKUP", status: "ASSIGNED", completedAt: null },
  }).assessLeg({ deliveryLegId: "leg-2" });
  assert.equal(result.readiness, "BLOCKED");
  assert.ok(result.blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"));
});

test("allows a later leg past the sequencing gate only after the preceding leg is completed", async () => {
  const leg = baseLeg({ sequence: 2 });
  leg.parcelBooking.quotes[0].inputSnapshot.routeSnapshot.legs[0].sequence = 2;
  leg.parcelBooking.quotes[0].inputSnapshot.operationalTariffAssessment.legs[0].sequence = 2;
  const result = await setup({
    leg,
    previousLeg: {
      id: "leg-1",
      sequence: 1,
      type: "LOCAL_PICKUP",
      status: "COMPLETED",
      completedAt: new Date("2026-11-13T17:30:00.000Z"),
    },
  }).assessLeg({ deliveryLegId: "leg-2" });
  assert.equal(result.blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"), false);
});


test("mixed three-leg HAT shipment releases each local and partner leg only after its predecessor completes", async () => {
  const quoteId = "mixed-route-quote";
  const bookingId = "mixed-route-booking";
  const packages = packageFacts.map(pkg => ({ ...pkg }));
  const routeLegs = [
    {
      sequence: 1, type: "LOCAL_PICKUP",
      originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-1",
      originHubPointId: null, destinationHubPointId: null,
      origin: { latitude: 6.5244, longitude: 3.3792 },
      destination: { latitude: 6.525, longitude: 3.38 },
    },
    {
      sequence: 2, type: "INTERSTATE_TRANSPORT",
      originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-2",
      originHubPointId: "hub-1", destinationHubPointId: "hub-2",
      origin: { latitude: 6.525, longitude: 3.38 },
      destination: { latitude: 7.1475, longitude: 3.3619 },
    },
    {
      sequence: 3, type: "FINAL_MILE",
      originServiceZoneId: "zone-2", destinationServiceZoneId: "zone-2",
      originHubPointId: "hub-2", destinationHubPointId: null,
      origin: { latitude: 7.1475, longitude: 3.3619 },
      destination: { latitude: 7.15, longitude: 3.365 },
    },
  ];
  const quote = {
    id: quoteId,
    status: "ACCEPTED",
    currency: "NGN",
    inputSnapshot: {
      source: "PLATFORM_OPERATIONAL_TARIFF",
      routeSnapshot: { legs: routeLegs },
      operationalTariffAssessment: {
        legs: routeLegs.map(routeLeg => ({
          sequence: routeLeg.sequence,
          type: routeLeg.type,
          packages: packages.map((pkg, index) => ({
            packageId: pkg.id,
            packageSequence: index + 1,
            packageCategory: pkg.packageCategory,
            weightGrams: pkg.weightGrams,
            dimensionsMm: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
          })),
        })),
      },
    },
    acceptedAt: now,
  };
  const legs = routeLegs.map(routeLeg => ({
    id: `mixed-leg-${routeLeg.sequence}`,
    sequence: routeLeg.sequence,
    type: routeLeg.type,
    status: "PLANNED",
    completedAt: null,
    originServiceZoneId: routeLeg.originServiceZoneId,
    destinationServiceZoneId: routeLeg.destinationServiceZoneId,
    originHubPointId: routeLeg.originHubPointId,
    destinationHubPointId: routeLeg.destinationHubPointId,
    originLatitude: routeLeg.origin.latitude,
    originLongitude: routeLeg.origin.longitude,
    destinationLatitude: routeLeg.destination.latitude,
    destinationLongitude: routeLeg.destination.longitude,
    metadata: {
      quoteId,
      pricingSource: "PLATFORM_OPERATIONAL_TARIFF",
      requiresOperationalReview: true,
      executionReadiness: "NOT_ASSESSED",
    },
    parcelBooking: {
      id: bookingId,
      paymentStatus: "SUCCEEDED",
      currency: "NGN",
      integrationClientId: null,
      integrationDispatchAuthorizedAt: null,
      parcelPackages: packages,
      quotes: [quote],
    },
  }));
  const previousByLegId = new Map(legs.map(leg => [
    leg.id,
    legs.find(candidate => candidate.sequence === leg.sequence - 1) ?? null,
  ]));
  const payoutRules = [
    {
      id: "pickup-payout-v1", version: 1, serviceZoneId: "zone-1",
      legType: "LOCAL_PICKUP", parcelCategory: "GENERAL",
      minWeightGrams: 0, maxWeightGrams: 1000, currency: "NGN",
      driverPayoutMinor: 25000n,
      effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
      effectiveUntil: null, status: "ACTIVE",
    },
    {
      id: "final-mile-payout-v1", version: 1, serviceZoneId: "zone-2",
      legType: "FINAL_MILE", parcelCategory: "GENERAL",
      minWeightGrams: 0, maxWeightGrams: 1000, currency: "NGN",
      driverPayoutMinor: 30000n,
      effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
      effectiveUntil: null, status: "ACTIVE",
    },
  ];
  const partnerRate = {
    id: "mixed-partner-rate",
    rateCardId: "mixed-partner-card",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    serviceType: "PARCEL_DELIVERY",
    parcelCategory: "GENERAL",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    maxLengthMm: null,
    maxWidthMm: null,
    maxHeightMm: null,
    transportChargeMinor: 18000n,
    estimatedTransitMinutes: 120,
    rateCard: {
      id: "mixed-partner-card",
      version: 3,
      agreementId: "mixed-partner-agreement",
      agreement: {
        id: "mixed-partner-agreement",
        reference: "MIXED-AGR-001",
        partner: { id: "mixed-partner", displayName: "Verified Interstate Partner" },
      },
    },
  };
  const tx = {
    platformDriverPayoutRule: {
      findMany: async ({ where }) => payoutRules.filter(rule =>
        rule.serviceZoneId === where.serviceZoneId
        && rule.legType === where.legType
        && rule.currency === where.currency
        && rule.status === where.status
        && rule.parcelCategory === "GENERAL"
        && rule.effectiveFrom <= where.effectiveFrom.lte
        && (rule.effectiveUntil == null || rule.effectiveUntil > now)),
    },
  };
  const repository = {
    findLeg: async (_tx, id) => legs.find(leg => leg.id === id) ?? null,
    findPreviousLeg: async (_tx, leg) => previousByLegId.get(leg.id),
    findActiveServiceZones: async (_tx, ids) => ids.map(id => ({ id })),
    findActiveHub: async (_tx, id) => hub(id, id === "hub-2" ? "zone-2" : "zone-1"),
    getHubLoad: async () => ({
      load: { _count: { _all: 0 }, _sum: { weightGrams: 0, volumeCm3: 0 } },
      missingVolumeCount: 0,
    }),
    findEligibleLocalDrivers: async (_tx, leg) => [driver({
      locations: [{
        latitude: leg.originLatitude,
        longitude: leg.originLongitude,
        recordedAt: now,
      }],
    })],
    findPartnerRates: async () => [partnerRate],
  };
  const prismaClient = {
    $transaction: callback => callback(tx),
    deliveryLeg: {
      findMany: async () => legs.map(({ id, sequence }) => ({ id, sequence })),
    },
  };
  const service = createExecutionReadinessService({
    prismaClient,
    repository,
    clock: () => now,
  });

  const initial = await service.assessBooking({ bookingId });
  assert.equal(initial.readiness, "BLOCKED");
  assert.deepEqual(initial.legs.map(item => item.readiness), ["READY", "BLOCKED", "BLOCKED"]);
  assert.equal(initial.legs[1].execution.mode, "TRANSPORT_PARTNER");
  assert.equal(initial.legs[2].execution.mode, "PLATFORM_DRIVER");
  assert.ok(initial.legs[1].blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"));
  assert.ok(initial.legs[2].blockers.some(item => item.code === "PREVIOUS_LEG_NOT_COMPLETED"));

  legs[0].status = "COMPLETED";
  legs[0].completedAt = new Date("2026-11-13T18:10:00.000Z");
  const interstate = await service.assessLeg({ deliveryLegId: "mixed-leg-2" });
  assert.equal(interstate.readiness, "READY");
  assert.equal(interstate.execution.mode, "TRANSPORT_PARTNER");
  assert.equal(interstate.execution.partnerCandidates[0].totalExecutionCostMinor, "18000");

  legs[1].status = "COMPLETED";
  legs[1].completedAt = new Date("2026-11-13T19:10:00.000Z");
  const finalMile = await service.assessLeg({ deliveryLegId: "mixed-leg-3" });
  assert.equal(finalMile.readiness, "READY");
  assert.equal(finalMile.execution.mode, "PLATFORM_DRIVER");
  assert.equal(finalMile.execution.payoutAssessment.totalDriverPayoutMinor, "30000");
  assert.equal(finalMile.dispatchAuthorized, false);
});


function executorRevalidationHarness({ selectedDriver = driver(), hubCapacity = 10, occupiedParcels = 0 } = {}) {
  const leg = baseLeg();
  let snapshotWrites = 0;
  const tx = {
    platformDriverPayoutRule: {
      findMany: async () => [{
        id: "payout-rule-revalidation", version: 2, serviceZoneId: "zone-1",
        legType: "LOCAL_PICKUP", parcelCategory: "GENERAL",
        minWeightGrams: 0, maxWeightGrams: 1000, currency: "NGN",
        driverPayoutMinor: 25000n, effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
        effectiveUntil: null, status: "ACTIVE",
      }],
    },
    deliveryLegOffer: { count: async () => 0 },
    driverAssignment: { count: async () => 0 },
    partnerDeliveryAssignment: { count: async () => 0 },
    deliveryLegExecutionSnapshot: {
      findUnique: async () => null,
      aggregate: async () => ({ _max: { version: null } }),
      create: async ({ data }) => {
        snapshotWrites += 1;
        return { id: "snapshot-revalidation", ...data };
      },
    },
    deliveryLeg: { updateMany: async () => ({ count: 1 }) },
    operationalAuditEvent: { create: async () => ({ id: "audit-revalidation" }) },
  };
  const repository = {
    findLeg: async () => leg,
    findActiveServiceZones: async (_tx, ids) => ids.map(id => ({ id })),
    findActiveHub: async (_tx, id) => hub(id, "zone-1", {
      capacityConfig: { maxParcels: hubCapacity },
    }),
    getHubLoad: async () => ({
      load: { _count: { _all: occupiedParcels }, _sum: { weightGrams: 0, volumeCm3: 0 } },
      missingVolumeCount: 0,
    }),
    findEligibleLocalDrivers: async () => [driver()],
    // The selected driver's fresh eligibility lookup can reflect a suspension,
    // expired KYC, stale location, or changed coverage after initial discovery.
    findEligibleLocalDriver: async () => selectedDriver,
    findPartnerRates: async () => [],
  };
  const prismaClient = { $transaction: callback => callback(tx) };
  return {
    service: createExecutionReadinessService({ prismaClient, repository, clock: () => now }),
    get snapshotWrites() { return snapshotWrites; },
  };
}

test("executor selection is rejected when the selected driver loses eligibility during revalidation", async () => {
  const harness = executorRevalidationHarness({ selectedDriver: null });
  const result = await harness.service.selectExecutor({
    deliveryLegId: "leg-1",
    executorType: "PLATFORM_DRIVER",
    driverProfileId: "driver-1",
    vehicleId: "vehicle-1",
    selectedByUserId: "admin-1",
    idempotencyKey: "revalidation-driver-ineligible",
  });

  assert.equal(result.blocked, true);
  assert.ok(result.blockers.some(item => item.code === "SELECTED_DRIVER_NO_LONGER_ELIGIBLE"));
  assert.equal(harness.snapshotWrites, 0);
});

test("executor selection is rejected when receiving-hub capacity is exhausted during revalidation", async () => {
  const harness = executorRevalidationHarness({ hubCapacity: 1, occupiedParcels: 1 });
  const result = await harness.service.selectExecutor({
    deliveryLegId: "leg-1",
    executorType: "PLATFORM_DRIVER",
    driverProfileId: "driver-1",
    vehicleId: "vehicle-1",
    selectedByUserId: "admin-1",
    idempotencyKey: "revalidation-hub-capacity",
  });

  assert.equal(result.blocked, true);
  assert.ok(result.blockers.some(item => item.code === "HUB_PARCEL_CAPACITY_EXCEEDED"));
  assert.equal(harness.snapshotWrites, 0);
});


function partnerRevalidationHarness() {
  const leg = baseLeg({
    type: "INTERSTATE_TRANSPORT",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    originHubPointId: "hub-1",
    destinationHubPointId: "hub-2",
  });
  const quote = leg.parcelBooking.quotes[0];
  quote.inputSnapshot.routeSnapshot.legs[0] = {
    sequence: 1,
    type: "INTERSTATE_TRANSPORT",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    originHubPointId: "hub-1",
    destinationHubPointId: "hub-2",
    origin: { latitude: leg.originLatitude, longitude: leg.originLongitude },
    destination: { latitude: leg.destinationLatitude, longitude: leg.destinationLongitude },
  };
  quote.inputSnapshot.operationalTariffAssessment.legs[0].type = "INTERSTATE_TRANSPORT";

  const activeRate = {
    id: "partner-rate-revalidation",
    rateCardId: "partner-card-revalidation",
    originServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    serviceType: "PARCEL_DELIVERY",
    parcelCategory: "GENERAL",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    maxLengthMm: null,
    maxWidthMm: null,
    maxHeightMm: null,
    transportChargeMinor: 18000n,
    estimatedTransitMinutes: 120,
    rateCard: {
      id: "partner-card-revalidation",
      version: 4,
      agreementId: "partner-agreement-revalidation",
      agreement: {
        id: "partner-agreement-revalidation",
        reference: "AGR-REVALIDATION",
        partner: { id: "partner-revalidation", displayName: "Verified Partner" },
      },
    },
  };
  let currentRates = [activeRate];
  let snapshotWrites = 0;
  const tx = {
    deliveryLegOffer: { count: async () => 0 },
    driverAssignment: { count: async () => 0 },
    partnerDeliveryAssignment: { count: async () => 0 },
    deliveryLegExecutionSnapshot: {
      findUnique: async () => null,
      aggregate: async () => ({ _max: { version: null } }),
      create: async ({ data }) => {
        snapshotWrites += 1;
        return { id: "partner-snapshot-revalidation", ...data };
      },
    },
    deliveryLeg: { updateMany: async () => ({ count: 1 }) },
    operationalAuditEvent: { create: async () => ({ id: "partner-audit-revalidation" }) },
  };
  const repository = {
    findLeg: async () => leg,
    findPreviousLeg: async () => null,
    findActiveServiceZones: async (_tx, ids) => ids.map(id => ({ id })),
    findActiveHub: async (_tx, id) => hub(id, id === "hub-2" ? "zone-2" : "zone-1"),
    getHubLoad: async () => ({
      load: { _count: { _all: 0 }, _sum: { weightGrams: 0, volumeCm3: 0 } },
      missingVolumeCount: 0,
    }),
    findEligibleLocalDrivers: async () => [],
    findEligibleLocalDriver: async () => null,
    findPartnerRates: async () => currentRates,
  };
  const prismaClient = { $transaction: callback => callback(tx) };
  return {
    service: createExecutionReadinessService({ prismaClient, repository, clock: () => now }),
    invalidatePartnerEligibility() { currentRates = []; },
    get snapshotWrites() { return snapshotWrites; },
  };
}

for (const scenario of [
  "partner suspension",
  "agreement expiry",
  "rate-card expiry or deactivation",
]) {
  test(`partner executor selection is blocked when ${scenario} occurs after candidate discovery`, async () => {
    const harness = partnerRevalidationHarness();
    const initial = await harness.service.assessLeg({ deliveryLegId: "leg-1" });
    assert.equal(initial.readiness, "READY");
    assert.equal(initial.execution.partnerCandidates[0].partnerId, "partner-revalidation");

    // Model the repository's active-rate query after the partner, agreement,
    // or rate card ceases to satisfy its current eligibility predicates.
    harness.invalidatePartnerEligibility();
    const result = await harness.service.selectExecutor({
      deliveryLegId: "leg-1",
      executorType: "TRANSPORT_PARTNER",
      partnerId: "partner-revalidation",
      selectedByUserId: "admin-1",
      idempotencyKey: `partner-revalidation-${scenario.replaceAll(/[^a-z]+/g, "-")}`,
    });

    assert.equal(result.blocked, true);
    assert.ok(result.blockers.some(item => item.code === "NO_PARTNER_EXECUTION_RATE"));
    assert.equal(harness.snapshotWrites, 0);
  });
}

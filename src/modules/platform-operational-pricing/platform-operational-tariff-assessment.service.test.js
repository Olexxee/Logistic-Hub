import test from "node:test";
import assert from "node:assert/strict";
import { assessPlatformOperationalTariffs } from "./platform-operational-tariff-assessment.service.js";

const now = new Date("2026-11-13T12:00:00.000Z");
const route = {
  routeMode: "HUB_ASSISTED",
  legs: [
    { sequence: 1, type: "LOCAL_PICKUP", originServiceZoneId: "zone-a", destinationHubPointId: "hub-a" },
    { sequence: 2, type: "INTERSTATE_TRANSPORT", originHubPointId: "hub-a", destinationHubPointId: "hub-b" },
    { sequence: 3, type: "FINAL_MILE", destinationServiceZoneId: "zone-b", originHubPointId: "hub-b" },
  ],
};
const packages = [{ id: "pkg-1", packageCategory: "GENERAL", weightGrams: 1500, lengthMm: 10, widthMm: 10, heightMm: 10 }];

function tariff(scope, legType, locator, id, charge) {
  return {
    id, version: 1, scope, legType, operationType: null, status: "ACTIVE",
    serviceZoneId: locator.serviceZoneId ?? null,
    originHubPointId: locator.originHubPointId ?? null,
    destinationHubPointId: locator.destinationHubPointId ?? null,
    hubPointId: null, parcelCategory: "GENERAL",
    minWeightGrams: 1001, maxWeightGrams: 3000,
    maxLengthMm: null, maxWidthMm: null, maxHeightMm: null,
    currency: "NGN", customerChargeMinor: BigInt(charge),
    platformChargeMinor: 100n, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
  };
}

function client({ missingAvailability = false, duplicatePickup = false } = {}) {
  const tariffs = [
    tariff("LOCAL_ZONE", "LOCAL_PICKUP", { serviceZoneId: "zone-a" }, "pickup", 1000),
    tariff("HUB_PAIR", "INTERSTATE_TRANSPORT", { originHubPointId: "hub-a", destinationHubPointId: "hub-b" }, "linehaul", 2000),
    tariff("LOCAL_ZONE", "FINAL_MILE", { serviceZoneId: "zone-b" }, "final", 3000),
  ];
  if (duplicatePickup) tariffs.push({ ...tariffs[0], id: "pickup-duplicate" });
  return {
    platformOperationalTariffAvailability: {
      findFirst: async ({ where }) => missingAvailability && where.scope === "HUB_PAIR" ? null : ({ isEnabled: true, startsAt: null, endsAt: null }),
    },
    platformOperationalTariff: {
      findMany: async ({ where }) => tariffs.filter(t =>
        t.scope === where.scope && t.legType === where.legType
        && t.serviceZoneId === where.serviceZoneId
        && t.originHubPointId === where.originHubPointId
        && t.destinationHubPointId === where.destinationHubPointId
        && t.parcelCategory.in.includes("GENERAL")
        && t.currency === where.currency
        && t.status === "ACTIVE" && t.effectiveFrom <= now),
    },
  };
}

test("assesses each resolved local and directed hub-pair leg without choosing topology", async () => {
  const tx = client();
  const tariffs = [
    tariff("LOCAL_ZONE", "LOCAL_PICKUP", { serviceZoneId: "zone-a" }, "pickup", 1000),
    tariff("HUB_PAIR", "INTERSTATE_TRANSPORT", { originHubPointId: "hub-a", destinationHubPointId: "hub-b" }, "linehaul", 2000),
    tariff("LOCAL_ZONE", "FINAL_MILE", { serviceZoneId: "zone-b" }, "final", 3000),
  ];
  tx.platformOperationalTariff.findMany = async ({ where }) => tariffs.filter(t =>
    t.scope === where.scope && t.legType === where.legType
    && t.serviceZoneId === where.serviceZoneId
    && t.originHubPointId === where.originHubPointId
    && t.destinationHubPointId === where.destinationHubPointId
    && t.parcelCategory === "GENERAL" && t.currency === where.currency && t.status === "ACTIVE");
  const result = await assessPlatformOperationalTariffs({ tx, route, packages, currency: "NGN", now });
  assert.equal(result.status, "QUOTED");
  assert.equal(result.legs.length, 3);
  assert.equal(result.totals.customerChargeMinor, "6000");
  assert.equal(result.totals.platformChargeMinor, "300");
  assert.equal(result.totals.totalCustomerChargeMinor, "6300");
  assert.deepEqual(result.legs.map(leg => leg.packages[0].tariff.id), ["pickup", "linehaul", "final"]);
  assert.equal(result.executionReadiness.status, "NOT_ASSESSED");
});

test("fails closed when exact-scope availability is absent", async () => {
  const tx = client({ missingAvailability: true });
  const result = await assessPlatformOperationalTariffs({ tx, route, packages, currency: "NGN", now });
  assert.equal(result.status, "NO_COVERAGE");
});

test("fails closed on ambiguous matching tariff bands", async () => {
  const tx = client({ duplicatePickup: true });
  const result = await assessPlatformOperationalTariffs({ tx, route, packages, currency: "NGN", now });
  assert.equal(result.status, "PRICING_AMBIGUOUS");
});

test("requires measurements instead of estimating package weight", async () => {
  const result = await assessPlatformOperationalTariffs({
    tx: client(), route, packages: [{ ...packages[0], weightGrams: null }], currency: "NGN", now,
  });
  assert.equal(result.status, "REQUIRES_MEASUREMENT");
});

test("does not charge handling when package attribution is missing", async () => {
  const result = await assessPlatformOperationalTariffs({
    tx: client(), route, packages, currency: "NGN", now,
    handlingOperations: [{
      id: "operation-1", status: "COMPLETED", operationType: "REPACKAGING",
      authorizedByUserId: "ops-1", authorizedAt: now,
      customerAuthorizedByUserId: "customer-1", customerAuthorizedAt: now,
      completedByUserId: "hub-1", completedAt: now,
    }],
  });
  assert.equal(result.status, "REQUIRES_OPERATIONAL_REVIEW");
  assert.equal(result.handling.status, "PACKAGE_ATTRIBUTION_REQUIRED");
});

test("requires manual assessment above the canonical 30 kg ceiling", async () => {
  const result = await assessPlatformOperationalTariffs({
    tx: client(), route, packages: [{ ...packages[0], weightGrams: 30001 }], currency: "NGN", now,
  });
  assert.equal(result.status, "REQUIRES_MANUAL_ASSESSMENT");
});

test("does not charge a completed handling operation without package attribution", async () => {
  const result = await assessPlatformOperationalTariffs({
    tx: client(), route, packages, currency: "NGN", now,
    handlingOperations: [{
      id: "operation-1", status: "COMPLETED",
      authorizedByUserId: "ops-1", authorizedAt: now,
      customerAuthorizedByUserId: "customer-1", customerAuthorizedAt: now,
      completedByUserId: "hub-1", completedAt: now,
    }],
  });
  assert.equal(result.status, "REQUIRES_OPERATIONAL_REVIEW");
  assert.equal(result.handling.status, "PACKAGE_ATTRIBUTION_REQUIRED");
});

test("does not charge cancelled handling operations", async () => {
  const result = await assessPlatformOperationalTariffs({
    tx: client(), route, packages, currency: "NGN", now,
    handlingOperations: [{ id: "cancelled-op", status: "CANCELLED" }],
  });
  assert.equal(result.status, "QUOTED");
  assert.equal(result.handling.status, "NO_CHARGEABLE_OPERATIONS");
});

test("rejects a hub-assisted route missing its interstate segment", async () => {
  const malformedRoute = { ...route, legs: [route.legs[0], route.legs[2]] };
  await assert.rejects(
    assessPlatformOperationalTariffs({ tx: client(), route: malformedRoute, packages, currency: "NGN", now }),
    error => error.code === "INVALID_OPERATIONAL_TARIFF_ASSESSMENT_INPUT",
  );
});

test("rejects non-hub-assisted routes and invalid route topology", async () => {
  await assert.rejects(
    assessPlatformOperationalTariffs({ tx: client(), route: { ...route, routeMode: "END_TO_END" }, packages, currency: "NGN", now }),
    error => error.code === "INVALID_OPERATIONAL_TARIFF_ASSESSMENT_INPUT",
  );
});

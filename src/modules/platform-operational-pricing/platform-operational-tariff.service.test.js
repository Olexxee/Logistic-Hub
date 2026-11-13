import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformOperationalTariffService } from "./platform-operational-tariff.service.js";

const fixedNow = new Date("2026-11-13T12:00:00.000Z");
const tariff = {
  id: "tariff-1", scope: "LOCAL_ZONE", serviceType: "PARCEL_DELIVERY",
  legType: "LOCAL_PICKUP", operationType: null, serviceZoneId: "zone-1",
  originHubPointId: null, destinationHubPointId: null, hubPointId: null,
  parcelCategory: "GENERAL", minWeightGrams: 1, maxWeightGrams: 1000,
  maxLengthMm: null, maxWidthMm: null, maxHeightMm: null, currency: "NGN",
  customerChargeMinor: 150000n, platformChargeMinor: 0n, version: 1,
  status: "DRAFT", effectiveFrom: fixedNow, effectiveUntil: null,
  publishedAt: null, createdByUserId: "admin-1",
};

function transactionClient(overrides = {}) {
  const auditEvents = [];
  const tx = {
    serviceZone: {
      findUnique: async () => ({ id: "zone-1" }),
      ...overrides.serviceZone,
    },
    hubPoint: { findMany: async () => [], ...overrides.hubPoint },
    platformOperationalTariff: {
      findFirst: async () => null,
      create: async ({ data }) => ({ ...tariff, ...data }),
      findUnique: async () => tariff,
      update: async ({ data }) => ({ ...tariff, ...data }),
      ...overrides.platformOperationalTariff,
    },
    platformOperationalTariffAvailability: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "availability-1", ...data }),
      update: async ({ data }) => ({ id: "availability-1", ...data }),
      ...overrides.platformOperationalTariffAvailability,
    },
    operationalAuditEvent: {
      create: async ({ data }) => { auditEvents.push(data); return data; },
    },
  };
  return { tx, auditEvents };
}

test("creates a draft tariff with BigInt storage and an audit event", async () => {
  const { tx, auditEvents } = transactionClient();
  const service = createPlatformOperationalTariffService({
    prismaClient: { $transaction: callback => callback(tx) },
    clock: () => fixedNow,
  });
  const created = await service.create({
    scope: "LOCAL_ZONE", serviceType: "PARCEL_DELIVERY", legType: "LOCAL_PICKUP",
    serviceZoneId: "zone-1", parcelCategory: "GENERAL", minWeightGrams: 1,
    maxWeightGrams: 1000, currency: "NGN", customerChargeMinor: "150000",
    platformChargeMinor: "0", effectiveFrom: fixedNow, reason: "Approved tariff",
  }, "admin-1");

  assert.equal(created.customerChargeMinor, "150000");
  assert.equal(created.platformChargeMinor, "0");
  assert.equal(created.status, "DRAFT");
  assert.equal(created.createdByUserId, "admin-1");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "PLATFORM_OPERATIONAL_TARIFF_CREATED");
  assert.equal("driverPayoutMinor" in created, false);
  assert.equal("partnerExecutionCostMinor" in created, false);
});

test("publishing fails closed when exact-scope availability is absent", async () => {
  const { tx } = transactionClient({
    serviceZone: {
      findUnique: async () => ({
        id: "zone-1", isActive: true,
        state: { isActive: true, country: { isActive: true } },
        availability: [{ isEnabled: true, startsAt: null, endsAt: null }],
      }),
    },
  });
  const service = createPlatformOperationalTariffService({
    prismaClient: { $transaction: callback => callback(tx) },
    clock: () => fixedNow,
  });

  await assert.rejects(
    service.publish("tariff-1", "admin-1", "Publish approved tariff"),
    error => error.code === "PLATFORM_OPERATIONAL_TARIFF_NOT_ENABLED",
  );
});

test("publishing rejects a non-draft tariff before changing state", async () => {
  const { tx } = transactionClient({
    platformOperationalTariff: {
      findUnique: async () => ({ ...tariff, status: "ACTIVE" }),
    },
  });
  const service = createPlatformOperationalTariffService({
    prismaClient: { $transaction: callback => callback(tx) },
    clock: () => fixedNow,
  });

  await assert.rejects(
    service.publish("tariff-1", "admin-1", "Publish approved tariff"),
    error => error.code === "PLATFORM_OPERATIONAL_TARIFF_NOT_DRAFT",
  );
});

test("retirement is restricted to active tariffs and is audited", async () => {
  const active = { ...tariff, status: "ACTIVE" };
  const { tx, auditEvents } = transactionClient({
    platformOperationalTariff: {
      findUnique: async () => active,
      update: async ({ data }) => ({ ...active, ...data }),
    },
  });
  const service = createPlatformOperationalTariffService({
    prismaClient: { $transaction: callback => callback(tx) },
    clock: () => fixedNow,
  });
  const retired = await service.retire("tariff-1", "admin-1", "Retire superseded tariff");
  assert.equal(retired.status, "RETIRED");
  assert.equal(auditEvents[0].action, "PLATFORM_OPERATIONAL_TARIFF_RETIRED");
});

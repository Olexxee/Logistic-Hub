import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformDriverPayoutService } from "./platform-driver-payout.service.js";

const now = new Date("2026-11-13T12:00:00.000Z");
const draft = {
  id: "payout-1",
  serviceZoneId: "zone-1",
  legType: "LOCAL_PICKUP",
  parcelCategory: "GENERAL",
  minWeightGrams: 0,
  maxWeightGrams: 1000,
  currency: "NGN",
  driverPayoutMinor: 25000n,
  version: 1,
  status: "DRAFT",
  effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
  effectiveUntil: null,
  publishedAt: null,
  createdByUserId: "admin-1",
};

function setup(overrides = {}) {
  const audit = [];
  const tx = {
    serviceZone: { findUnique: async () => ({ id: "zone-1" }), ...overrides.serviceZone },
    platformDriverPayoutRule: {
      findFirst: async () => null,
      create: async ({ data }) => ({ ...draft, ...data }),
      findUnique: async () => draft,
      findMany: async () => [],
      update: async ({ data }) => ({ ...draft, ...data }),
      ...overrides.platformDriverPayoutRule,
    },
    operationalAuditEvent: {
      create: async ({ data }) => { audit.push(data); return data; },
    },
  };
  return { tx, audit };
}

const serviceFor = tx => createPlatformDriverPayoutService({
  prismaClient: { $transaction: (callback, options) => callback(tx) },
  clock: () => now,
});

test("creates immutable draft payout versions using BigInt and writes audit", async () => {
  const { tx, audit } = setup();
  const service = serviceFor(tx);
  const created = await service.create({
    serviceZoneId: "zone-1",
    legType: "LOCAL_PICKUP",
    parcelCategory: "GENERAL",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    currency: "NGN",
    driverPayoutMinor: "25000",
    effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
    reason: "Approved local payout",
  }, "admin-1");

  assert.equal(created.driverPayoutMinor, "25000");
  assert.equal(created.status, "DRAFT");
  assert.equal(created.version, 1);
  assert.equal(audit[0].action, "PLATFORM_DRIVER_PAYOUT_RULE_CREATED");
});

test("rejects creation when service zone does not exist", async () => {
  const { tx } = setup({ serviceZone: { findUnique: async () => null } });
  await assert.rejects(
    serviceFor(tx).create({
      serviceZoneId: "missing",
      legType: "LOCAL_PICKUP",
      parcelCategory: "GENERAL",
      minWeightGrams: 0,
      maxWeightGrams: 1000,
      currency: "NGN",
      driverPayoutMinor: "25000",
      effectiveFrom: now,
      reason: "Approved local payout",
    }, "admin-1"),
    error => error.code === "SERVICE_ZONE_NOT_FOUND",
  );
});

test("publishes a valid draft and audits the immutable transition", async () => {
  const { tx, audit } = setup();
  const published = await serviceFor(tx).publish("payout-1", "admin-1", "Policy approved");
  assert.equal(published.status, "ACTIVE");
  assert.equal(published.publishedAt.toISOString(), now.toISOString());
  assert.equal(audit[0].action, "PLATFORM_DRIVER_PAYOUT_RULE_PUBLISHED");
});

test("rejects overlapping active weight and effective windows", async () => {
  const overlapping = {
    ...draft,
    id: "payout-2",
    minWeightGrams: 500,
    maxWeightGrams: 1500,
    status: "ACTIVE",
    effectiveFrom: new Date("2026-11-10T00:00:00.000Z"),
  };
  const { tx } = setup({
    platformDriverPayoutRule: { findMany: async () => [overlapping] },
  });
  await assert.rejects(
    serviceFor(tx).publish("payout-1", "admin-1", "Policy approved"),
    error => error.code === "PLATFORM_DRIVER_PAYOUT_RULE_OVERLAP",
  );
});

test("allows non-overlapping weight bands in the same scope", async () => {
  const adjacent = {
    ...draft,
    id: "payout-2",
    minWeightGrams: 1001,
    maxWeightGrams: 2000,
    status: "ACTIVE",
  };
  const { tx } = setup({
    platformDriverPayoutRule: { findMany: async () => [adjacent] },
  });
  const published = await serviceFor(tx).publish("payout-1", "admin-1", "Policy approved");
  assert.equal(published.status, "ACTIVE");
});

test("retirement only permits active rules and records audit", async () => {
  const active = { ...draft, status: "ACTIVE" };
  const { tx, audit } = setup({
    platformDriverPayoutRule: {
      findUnique: async () => active,
      update: async ({ data }) => ({ ...active, ...data }),
    },
  });
  const retired = await serviceFor(tx).retire("payout-1", "admin-1", "Superseded payout");
  assert.equal(retired.status, "RETIRED");
  assert.equal(audit[0].action, "PLATFORM_DRIVER_PAYOUT_RULE_RETIRED");
});

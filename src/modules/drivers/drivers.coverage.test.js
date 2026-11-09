import test from "node:test";
import assert from "node:assert/strict";
import { createDriversService } from "./drivers.service.js";
import { driverCoverageSchema } from "./drivers.schemas.js";

const now = new Date("2026-11-09T12:00:00.000Z");
const input = {
  driverProfileId: "driver-1",
  serviceZoneId: "zone-1",
  serviceType: "PARCEL_DELIVERY",
  isEnabled: true,
  reason: "Assign this verified driver to the approved operating area.",
};

function createPrisma({ eligible = true, previous = null, transactionFailures = 0 } = {}) {
  const calls = { upsert: 0, audit: [] };
  const tx = {
    serviceZone: {
      findUnique: async () => ({
        id: "zone-1",
        isActive: eligible,
        state: { isActive: eligible, country: { isActive: eligible } },
        availability: eligible ? [{ isEnabled: true }] : [],
      }),
    },
    driverProfile: { findUnique: async () => ({ id: "driver-1" }) },
    driverCoverage: {
      findUnique: async () => previous,
      upsert: async ({ create, update }) => {
        calls.upsert += 1;
        return {
          id: "coverage-1",
          driverProfileId: create?.driverProfileId ?? "driver-1",
          serviceZoneId: create?.serviceZoneId ?? "zone-1",
          serviceType: create?.serviceType ?? "PARCEL_DELIVERY",
          isEnabled: create?.isEnabled ?? update.isEnabled,
        };
      },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { calls.audit.push(data); return data; },
    },
  };
  let attempts = 0;
  const prisma = {
    $transaction: async (callback, options) => {
      attempts += 1;
      calls.transactionAttempts = attempts;
      calls.transactionOptions = options;
      if (attempts <= transactionFailures) {
        const error = new Error("Serialization conflict");
        error.code = "P2034";
        throw error;
      }
      return callback(tx);
    },
  };
  return { prisma, calls };
}

test("driver coverage requires an auditable reason", () => {
  assert.equal(driverCoverageSchema.safeParse(input).success, true);
  const { reason: _reason, ...withoutReason } = input;
  assert.equal(driverCoverageSchema.safeParse(withoutReason).success, false);
});

test("coverage assignment is transactional and writes an actor-attributed audit event", async () => {
  const { prisma, calls } = createPrisma();
  const service = createDriversService({ prismaClient: prisma, clock: () => now });
  const result = await service.setCoverage({ input, actorUserId: "admin-1" });
  assert.equal(result.id, "coverage-1");
  assert.equal(calls.upsert, 1);
  assert.equal(calls.transactionOptions.isolationLevel, "Serializable");
  assert.equal(calls.audit.length, 1);
  assert.equal(calls.audit[0].actorUserId, "admin-1");
  assert.equal(calls.audit[0].reason, input.reason);
  assert.equal(calls.audit[0].action, "DRIVER_COVERAGE_ENABLED");
});

test("coverage cannot be enabled when the zone or service availability is ineligible", async () => {
  const { prisma, calls } = createPrisma({ eligible: false });
  const service = createDriversService({ prismaClient: prisma, clock: () => now });
  await assert.rejects(
    service.setCoverage({ input, actorUserId: "admin-1" }),
    error => error.code === "SERVICE_ZONE_NOT_ELIGIBLE",
  );
  assert.equal(calls.upsert, 0);
  assert.equal(calls.audit.length, 0);
});

test("disabling existing coverage remains possible and is audited", async () => {
  const previous = {
    id: "coverage-1",
    driverProfileId: "driver-1",
    serviceZoneId: "zone-1",
    serviceType: "PARCEL_DELIVERY",
    isEnabled: true,
  };
  const { prisma, calls } = createPrisma({ eligible: false, previous });
  const service = createDriversService({ prismaClient: prisma, clock: () => now });
  const result = await service.setCoverage({
    input: { ...input, isEnabled: false, reason: "Disable coverage pending an operational review." },
    actorUserId: "admin-1",
  });
  assert.equal(result.isEnabled, false);
  assert.equal(calls.audit[0].action, "DRIVER_COVERAGE_DISABLED");
  assert.equal(calls.audit[0].before.isEnabled, true);
  assert.equal(calls.audit[0].after.isEnabled, false);
});

test("retries transient serializable transaction conflicts", async () => {
  const { prisma, calls } = createPrisma({ transactionFailures: 1 });
  const service = createDriversService({ prismaClient: prisma, clock: () => now });
  await service.setCoverage({ input, actorUserId: "admin-1" });
  assert.equal(calls.transactionAttempts, 2);
  assert.equal(calls.upsert, 1);
  assert.equal(calls.audit.length, 1);
});

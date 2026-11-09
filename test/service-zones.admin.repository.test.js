import test from "node:test";
import assert from "node:assert/strict";
import { createServiceZonesAdminRepository } from "../src/modules/geography/service-zones.admin.repository.js";

test("readiness repository scopes availability, coverage and pricing to service and current time", async () => {
  const calls = [];
  const prismaClient = {
    serviceZone: { findMany: async args => { calls.push(["zones", args]); return []; } },
    pricingRule: { findMany: async args => { calls.push(["global-pricing", args]); return []; } },
  };
  const repository = createServiceZonesAdminRepository({ prismaClient });
  const now = new Date("2026-11-09T12:00:00.000Z");
  await repository.listReadiness({ serviceType: "PARCEL_DELIVERY", now });
  await repository.listGlobalPricingRules({ serviceType: "PARCEL_DELIVERY", now });
  const zoneQuery = calls.find(([kind]) => kind === "zones")[1];
  const globalPricingQuery = calls.find(([kind]) => kind === "global-pricing")[1];
  assert.deepEqual(zoneQuery.include.availability.where, { serviceType: "PARCEL_DELIVERY" });
  assert.deepEqual(zoneQuery.include.coverage.where, { serviceType: "PARCEL_DELIVERY", isEnabled: true });
  assert.equal(zoneQuery.include.pricingRules.where.effectiveFrom.lte, now);
  assert.equal(globalPricingQuery.where.serviceZoneId, null);
  assert.equal(globalPricingQuery.where.effectiveFrom.lte, now);
});
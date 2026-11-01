import test from "node:test";
import assert from "node:assert/strict";
import { createServiceZonesAdminService } from "../src/modules/geography/service-zones.admin.service.js";

const now = new Date("2026-10-31T12:00:00.000Z");
function fixture({ activeHubs = 0, availability = [{ id: "availability-1", serviceType: "PARCEL_DELIVERY", isEnabled: true, startsAt: null, endsAt: null }], lgaId = null } = {}) {
  const zone = {
    id: "zone-1", stateId: "state-1", lgaId, code: "ZONE1", name: "Central Zone", isActive: true,
    state: { id: "state-1", isActive: true, country: { id: "country-1", isActive: true } },
    availability,
  };
  let updatedZone = null;
  let upsertedAvailability = null;
  let auditEvents = [];
  let updateCalls = 0;
  const tx = {
    serviceZone: {
      findUnique: async () => zone,
      update: async ({ data }) => { updateCalls++; updatedZone = { ...zone, ...data }; return updatedZone; },
    },
    hubPoint: { count: async () => activeHubs },
    lGA: { findUnique: async ({ where }) => ({ id: where.id, stateId: "state-1" }) },
    serviceAvailability: {
      upsert: async ({ create, update }) => {
        upsertedAvailability = { id: "availability-1", ...create, ...update };
        return upsertedAvailability;
      },
    },
    operationalAuditEvent: { create: async ({ data }) => { auditEvents.push(data); return { id: "audit-1", ...data }; } },
  };
  const prismaClient = {
    serviceZone: { findMany: async () => [] },
    $transaction: async callback => callback(tx),
  };
  return {
    service: createServiceZonesAdminService({ prismaClient, clock: () => now }),
    get updatedZone() { return updatedZone; },
    get upsertedAvailability() { return upsertedAvailability; },
    get auditEvents() { return auditEvents; },
    get updateCalls() { return updateCalls; },
  };
}

test("service zone cannot be deactivated while active hubs remain", async () => {
  const f = fixture({ activeHubs: 2 });
  await assert.rejects(f.service.setActive("zone-1", false, "admin-1"), {
    code: "ACTIVE_HUBS_EXIST", statusCode: 409,
  });
  assert.equal(f.updateCalls, 0);
  assert.equal(f.auditEvents.length, 0);
});

test("parcel delivery cannot be disabled while active hubs remain", async () => {
  const f = fixture({ activeHubs: 1 });
  await assert.rejects(f.service.setAvailability("zone-1", {
    serviceType: "PARCEL_DELIVERY", isEnabled: false,
  }, "admin-1"), { code: "ACTIVE_HUBS_EXIST", statusCode: 409 });
  assert.equal(f.upsertedAvailability, null);
  assert.equal(f.auditEvents.length, 0);
});

test("parcel delivery cannot be scheduled outside its effective window while active hubs remain", async () => {
  const f = fixture({ activeHubs: 1 });
  await assert.rejects(f.service.setAvailability("zone-1", {
    serviceType: "PARCEL_DELIVERY", isEnabled: true,
    startsAt: new Date("2026-11-01T00:00:00.000Z"),
  }, "admin-1"), { code: "ACTIVE_HUBS_EXIST", statusCode: 409 });
  assert.equal(f.upsertedAvailability, null);
});

test("service zone LGA cannot change while active hubs remain", async () => {
  const f = fixture({ activeHubs: 1, lgaId: "lga-1" });
  await assert.rejects(f.service.update("zone-1", { lgaId: "lga-2" }, "admin-1"), {
    code: "ACTIVE_HUBS_EXIST", statusCode: 409,
  });
  assert.equal(f.updateCalls, 0);
});

test("active hubs may remain when parcel availability is updated without closing its current window", async () => {
  const f = fixture({ activeHubs: 1 });
  const result = await f.service.setAvailability("zone-1", {
    serviceType: "PARCEL_DELIVERY", isEnabled: true,
    endsAt: new Date("2026-11-30T23:59:59.000Z"), config: { maxDailyBookings: 40 },
  }, "admin-1");
  assert.equal(result.isEnabled, true);
  assert.equal(f.auditEvents.length, 1);
  assert.equal(f.auditEvents[0].action, "SERVICE_ZONE_AVAILABILITY_UPDATED");
  assert.equal(f.auditEvents[0].metadata.configChanged, true);
  assert.equal(Object.hasOwn(f.auditEvents[0].after, "config"), false);
});

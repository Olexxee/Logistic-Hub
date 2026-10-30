import test from "node:test";
import assert from "node:assert/strict";
import { createHubPointsAdminService } from "../src/modules/hub-points/hub-points.admin.service.js";
import { openingHoursAdminSchema, capacityConfigAdminSchema } from "../src/modules/hub-points/hub-points.admin.validators.js";

const openingHours = Object.fromEntries(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"].map(day => [day, [{ opensAt: "08:00", closesAt: "18:00" }]]));
const readyHub = () => ({
  id: "hub-1", status: "PENDING", operatorVerificationStatus: "VERIFIED", operatorVerifiedAt: new Date(), operatorName: "Hub Operator", operatorPhone: "+2348000000000",
  openingHours, acceptedParcelTypes: ["DOCUMENTS", "SMALL_PARCEL"], capacityConfig: { maxParcels: 80 },
  serviceZone: { isActive: true, state: { isActive: true, country: { isActive: true } }, availability: [{ serviceType: "PARCEL_DELIVERY", isEnabled: true, startsAt: null, endsAt: null }] },
});

test("opening hours require all weekdays and valid, ordered time windows", () => {
  assert.equal(openingHoursAdminSchema.safeParse(openingHours).success, true);
  assert.equal(openingHoursAdminSchema.safeParse({ MONDAY: [{ opensAt: "18:00", closesAt: "08:00" }] }).success, false);
});

test("capacity configuration requires a positive parcel limit", () => {
  assert.equal(capacityConfigAdminSchema.safeParse({ maxParcels: 80 }).success, true);
  assert.equal(capacityConfigAdminSchema.safeParse({ maxParcels: 0 }).success, false);
});

test("hub activation is blocked until operational details are complete", async () => {
  const hub = readyHub();
  hub.operatorPhone = null;
  const prismaClient = {
    hubPoint: { findUnique: async () => hub, update: async ({ data }) => ({ ...hub, ...data }) },
    serviceZone: {},
    $transaction: async callback => callback({ hubPoint: { update: async ({ data }) => ({ ...hub, ...data }) }, operationalAuditEvent: { create: async () => ({}) } }),
  };
  const service = createHubPointsAdminService({ prismaClient });
  await assert.rejects(service.setStatus("hub-1", "ACTIVE"), { code: "HUB_OPERATIONAL_DETAILS_REQUIRED", statusCode: 409 });
});

test("hub activation succeeds only when operational details and service eligibility are complete", async () => {
  const hub = readyHub();
  const prismaClient = {
    hubPoint: { findUnique: async () => hub, update: async ({ data }) => ({ ...hub, ...data }) },
    serviceZone: {},
  };
  const service = createHubPointsAdminService({ prismaClient });
  const result = await service.setStatus("hub-1", "ACTIVE");
  assert.equal(result.status, "ACTIVE");
});

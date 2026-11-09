import test from "node:test";
import assert from "node:assert/strict";
import {
  activeDriverDocumentWhere,
  activeServiceZoneWhere,
  eligibleParcelDriverWhere,
  eligibleParcelAssignmentDriverWhere,
  eligibleVehicleWhere,
  parcelCapabilityForLegType,
} from "../src/modules/drivers/driver-dispatch-eligibility.js";

const now = new Date("2026-11-08T18:00:00.000Z");

test("parcel leg types map only to the approved driver capability catalogue", () => {
  assert.equal(parcelCapabilityForLegType("DIRECT"), "LOCAL_DISPATCH");
  assert.equal(parcelCapabilityForLegType("LOCAL_PICKUP"), "PICKUP_COLLECTION");
  assert.equal(parcelCapabilityForLegType("FINAL_MILE"), "FINAL_MILE_DELIVERY");
  assert.equal(parcelCapabilityForLegType("HUB_TRANSFER"), null);
  assert.equal(parcelCapabilityForLegType("INTERSTATE_TRANSPORT"), null);
});

test("candidate matching requires an approved driver grant and an approved vehicle grant", () => {
  const where = eligibleParcelDriverWhere({
    capability: "FINAL_MILE_DELIVERY",
    now,
    strictMode: false,
    kycTiers: ["FULL"],
  });
  assert.deepEqual(where.capabilities, {
    some: { capability: "FINAL_MILE_DELIVERY", status: "APPROVED" },
  });
  assert.deepEqual(where.vehicles.some.serviceCapabilities, {
    some: { capability: "FINAL_MILE_DELIVERY", status: "APPROVED" },
  });
  assert.equal(where.vehicles.some.isActive, true);
  assert.equal(where.vehicles.some.verificationStatus, "VERIFIED");
});

test("strict KYC dispatch excludes expired identity, licence and vehicle-registration evidence", () => {
  const driverWhere = activeDriverDocumentWhere(now, true);
  const vehicleWhere = eligibleVehicleWhere({
    capability: "LOCAL_DISPATCH",
    now,
    strictMode: true,
  });
  assert.equal(driverWhere.verificationDocuments.some.documentType, "IDENTITY");
  assert.deepEqual(driverWhere.verificationDocuments.some.OR, [
    { expiresAt: null },
    { expiresAt: { gt: now } },
  ]);
  const motorVehicle = vehicleWhere.OR[1];
  assert.equal(motorVehicle.AND[0].verificationDocuments.some.documentType, "VEHICLE_REGISTRATION");
  assert.equal(motorVehicle.AND[1].driverProfile.is.verificationDocuments.some.documentType, "DRIVER_LICENSE");
  assert.deepEqual(motorVehicle.AND[0].verificationDocuments.some.OR, [
    { expiresAt: null },
    { expiresAt: { gt: now } },
  ]);
  assert.equal(vehicleWhere.OR[0].type, "BICYCLE");
});

test("service-zone eligibility requires active country/state/zone and current parcel availability", () => {
  const where = activeServiceZoneWhere(now);
  assert.equal(where.isActive, true);
  assert.deepEqual(where.state, {
    isActive: true,
    country: { isActive: true },
  });
  assert.equal(where.availability.some.serviceType, "PARCEL_DELIVERY");
  assert.equal(where.availability.some.isEnabled, true);
  assert.deepEqual(where.availability.some.AND, [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ]);
});


test("parcel assignment execution rechecks driver capability, active account, KYC and strict identity evidence without requiring availability", () => {
  const where = eligibleParcelAssignmentDriverWhere({
    driverProfileId: "driver_1",
    capability: "PICKUP_COLLECTION",
    now,
    strictMode: true,
    kycTiers: ["FULL"],
  });
  assert.equal(where.id, "driver_1");
  assert.equal(where.verificationStatus, "VERIFIED");
  assert.deepEqual(where.kycTier, { in: ["FULL"] });
  assert.equal(where.suspendedAt, null);
  assert.deepEqual(where.user, {
    is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } },
  });
  assert.deepEqual(where.capabilities.some, {
    capability: "PICKUP_COLLECTION",
    status: "APPROVED",
  });
  assert.equal(where.verificationDocuments.some.documentType, "IDENTITY");
  assert.equal("isAvailable" in where, false);
  assert.equal("isOnline" in where, false);
  const withCoverage = eligibleParcelAssignmentDriverWhere({
    driverProfileId: "driver_1", capability: "PICKUP_COLLECTION", now,
    requiredServiceZoneIds: ["zone_origin", "zone_destination"],
  });
  assert.deepEqual(withCoverage.AND.map(item => item.coverage.some.serviceZoneId), ["zone_origin", "zone_destination"]);
});

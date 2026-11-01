import test from "node:test";
import assert from "node:assert/strict";
import { createHubPointsAdminService } from "../src/modules/hub-points/hub-points.admin.service.js";
import { createCustodyService } from "../src/modules/custody/custody.service.js";
import { createHubPointAdminSchema, updateHubPointAdminSchema, openingHoursAdminSchema, capacityConfigAdminSchema } from "../src/modules/hub-points/hub-points.admin.validators.js";

const openingHours = Object.fromEntries(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"].map(day => [day, [{ opensAt: "08:00", closesAt: "18:00" }]]));
const readyHub = () => ({
  id: "hub-1", status: "PENDING", operatorVerificationStatus: "VERIFIED", operatorVerifiedAt: new Date(), operatorName: "Hub Operator", operatorPhone: "+2348000000000",
  openingHours, acceptedParcelTypes: ["DOCUMENTS", "SMALL_PARCEL"], capacityConfig: { maxParcels: 80 },
  serviceZone: { isActive: true, state: { isActive: true, country: { isActive: true } }, availability: [{ serviceType: "PARCEL_DELIVERY", isEnabled: true, startsAt: null, endsAt: null }] },
});
function prismaFor(hub) {
  return {
    hubPoint: { findUnique: async () => hub, update: async ({ data }) => ({ ...hub, ...data }) },
    serviceZone: {},
    $transaction: async callback => callback({
      hubPoint: { findUnique: async () => hub, update: async ({ data }) => ({ ...hub, ...data }) },
      hubPointOperator: { count: async () => 1 },
      operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
    }),
  };
}

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
  const service = createHubPointsAdminService({ prismaClient: prismaFor(hub) });
  await assert.rejects(service.setStatus("hub-1", "ACTIVE", "admin-1"), { code: "HUB_OPERATIONAL_DETAILS_REQUIRED", statusCode: 409 });
});

test("hub activation writes its audit event in the same transaction", async () => {
  const hub = readyHub();
  let auditData;
  const prismaClient = prismaFor(hub);
  prismaClient.$transaction = async callback => callback({
    hubPoint: { findUnique: async () => hub, update: async ({ data }) => ({ ...hub, ...data }) },
    hubPointOperator: { count: async () => 1 },
    operationalAuditEvent: { create: async ({ data }) => { auditData = data; return { id: "audit-1" }; } },
  });
  const service = createHubPointsAdminService({ prismaClient });
  const result = await service.setStatus("hub-1", "ACTIVE", "admin-1");
  assert.equal(result.status, "ACTIVE");
  assert.equal(auditData.actorUserId, "admin-1");
  assert.equal(auditData.action, "HUB_STATUS_UPDATED");
  assert.deepEqual(auditData.before, { status: "PENDING" });
  assert.deepEqual(auditData.after, { status: "ACTIVE" });
});


test("an active hub cannot lose verified operator status without first being suspended", async () => {
  const hub = readyHub();
  hub.status = "ACTIVE";
  const prismaClient = prismaFor(hub);
  let updateCalled = false;
  prismaClient.$transaction = async callback => callback({
    hubPoint: {
      findUnique: async () => hub,
      update: async ({ data }) => { updateCalled = true; return { ...hub, ...data }; },
    },
    operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
  });
  const service = createHubPointsAdminService({ prismaClient });
  await assert.rejects(service.reviewOperator({
    id: "hub-1", verificationStatus: "REJECTED", notes: "Verification withdrawn", actorUserId: "admin-1",
  }), { code: "ACTIVE_HUB_OPERATOR_VERIFICATION_REQUIRED", statusCode: 409 });
  assert.equal(updateCalled, false);
});


test("a hub with an active delivery leg cannot be permanently closed", async () => {
  const hub = readyHub();
  hub.status = "ACTIVE";
  const prismaClient = prismaFor(hub);
  let updateCalled = false;
  prismaClient.$transaction = async callback => callback({
    hubPoint: {
      findUnique: async () => hub,
      update: async ({ data }) => { updateCalled = true; return { ...hub, ...data }; },
    },
    deliveryLeg: { count: async () => 1 },
    hubIntakeRecord: { count: async () => 0 },
    custodyHandover: { count: async () => 0 },
    operationalCase: { count: async () => 0 },
    operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
  });
  const service = createHubPointsAdminService({ prismaClient });
  await assert.rejects(service.setStatus("hub-1", "CLOSED", "admin-1"), {
    code: "HUB_HAS_OPEN_OPERATIONS", statusCode: 409,
  });
  assert.equal(updateCalled, false);
});


test("hub activation requires an active manager membership", async () => {
  const hub = readyHub();
  let updated = false;
  const prismaClient = prismaFor(hub);
  prismaClient.$transaction = async callback => callback({
    hubPoint: { findUnique: async () => hub, update: async ({ data }) => { updated = true; return { ...hub, ...data }; } },
    hubPointOperator: { count: async () => 0 },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  });
  const service = createHubPointsAdminService({ prismaClient });
  await assert.rejects(service.setStatus("hub-1", "ACTIVE", "admin-1"), { code: "HUB_MANAGER_REQUIRED", statusCode: 409 });
  assert.equal(updated, false);
});


test("the last active manager cannot be deactivated while a hub is active", async () => {
  const hub = readyHub();
  hub.status = "ACTIVE";
  let updateCalled = false;
  const prismaClient = prismaFor(hub);
  prismaClient.$transaction = async callback => callback({
    hubPoint: { findUnique: async () => hub },
    hubPointOperator: {
      findFirst: async () => ({ id: "manager-1", role: "MANAGER", isActive: true }),
      count: async () => 0,
      update: async () => { updateCalled = true; },
    },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.setHubOperatorStatus({
    hubPointId: "hub-1", operatorId: "manager-1", isActive: false, actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "LAST_ACTIVE_HUB_MANAGER");
  assert.equal(updateCalled, false);
});


test("an active hub cannot be moved backwards to PENDING", async () => {
  const hub = readyHub();
  hub.status = "ACTIVE";
  let updateCalled = false;
  const prismaClient = prismaFor(hub);
  prismaClient.$transaction = async callback => callback({
    hubPoint: { findUnique: async () => hub, update: async ({ data }) => { updateCalled = true; return { ...hub, ...data }; } },
  });
  const service = createHubPointsAdminService({ prismaClient });
  await assert.rejects(service.setStatus("hub-1", "PENDING", "admin-1"), { code: "HUB_INVALID_STATUS_TRANSITION", statusCode: 409 });
  assert.equal(updateCalled, false);
});


test("an active hub cannot demote its last manager through operator upsert", async () => {
  const hub = readyHub();
  hub.status = "ACTIVE";
  let upsertCalled = false;
  const prismaClient = prismaFor(hub);
  prismaClient.$transaction = async callback => callback({
    hubPoint: { findUnique: async () => hub },
    user: { findUnique: async () => ({ id: "manager-1", status: "ACTIVE", emailVerifiedAt: new Date(), role: "HUB_OPERATOR" }) },
    hubPointOperator: {
      findUnique: async () => ({ id: "operator-1", role: "MANAGER", isActive: true }),
      count: async () => 0,
      upsert: async () => { upsertCalled = true; },
    },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  });
  const service = createCustodyService({ prismaClient });
  const result = await service.addHubOperator({
    hubPointId: "hub-1", userId: "manager-1", role: "OPERATOR", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "LAST_ACTIVE_HUB_MANAGER");
  assert.equal(upsertCalled, false);
});


test("partner ownership can be set at hub creation but cannot be changed through generic edits", () => {
  const create = createHubPointAdminSchema.safeParse({
    partnerId: "partner-1", serviceZoneId: "zone-1", name: "Partner Hub",
    address: "12 Allen Avenue, Ikeja", latitude: 6.6, longitude: 3.35,
  });
  assert.equal(create.success, true);
  assert.equal(updateHubPointAdminSchema.safeParse({ partnerId: "partner-2" }).success, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHubApplicationsService } from "../src/modules/hub-applications/hub-applications.service.js";

const now = new Date("2026-11-01T12:00:00.000Z");
const zone = { id: "zone-1", isActive: true, state: { isActive: true, country: { isActive: true } } };
const partner = { id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" };
const applicant = { id: "owner-1", status: "ACTIVE", emailVerifiedAt: now };
const application = {
  id: "application-1", partnerId: "partner-1", applicantUserId: "owner-1",
  serviceZoneId: "zone-1", name: "Ikeja Hub", address: "12 Allen Avenue, Ikeja",
  latitude: 6.6018, longitude: 3.3515, operatorName: "Hub Manager",
  operatorPhone: "+2348012345678",
  openingHours: { MONDAY: [{ opensAt: "08:00", closesAt: "18:00" }] },
  acceptedParcelTypes: ["DOCUMENTS"], capacityConfig: { maxParcels: 80 },
  status: "PENDING", partner, applicant, serviceZone: zone,
};
function makePrisma(overrides = {}) {
  const state = { applications: [], hubs: [], managers: [], audits: [], ...overrides };
  const tx = {
    transportPartner: { findUnique: async () => partner },
    transportPartnerMember: {
      findUnique: async () => ({ role: "OWNER", isActive: true }),
    },
    user: { findUnique: async () => applicant },
    serviceZone: { findUnique: async () => zone },
    hubApplication: {
      findFirst: async ({ where }) => state.applications.find(item => item.partnerId === where.partnerId && item.serviceZoneId === where.serviceZoneId && item.status === where.status) ?? null,
      create: async ({ data }) => { const result = { ...application, ...data }; state.applications.push(result); return result; },
      findUnique: async () => state.application ?? application,
      findFirstById: async () => application,
      update: async ({ data }) => { state.application = { ...application, ...data }; return state.application; },
    },
    hubPoint: {
      create: async ({ data }) => { const hub = { id: "hub-created", ...data }; state.hubs.push(hub); return hub; },
    },
    hubPointOperator: {
      upsert: async ({ create, update }) => { const manager = { id: "manager-1", ...create, ...update }; state.managers.push(manager); return manager; },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { state.audits.push(data); return { id: `audit-${state.audits.length}`, ...data }; },
    },
  };
  return {
    state,
    prismaClient: {
      ...tx,
      $transaction: async callback => callback(tx),
    },
  };
}

const validInput = {
  partnerId: "partner-1", serviceZoneId: "zone-1", name: "Ikeja Hub",
  address: "12 Allen Avenue, Ikeja", latitude: 6.6018, longitude: 3.3515,
  operatorName: "Hub Manager", operatorPhone: "+2348012345678",
  openingHours: { MONDAY: [{ opensAt: "08:00", closesAt: "18:00" }] },
  acceptedParcelTypes: ["DOCUMENTS"], capacityConfig: { maxParcels: 80 },
};

test("only an active partner OWNER can submit a hub application", async () => {
  const { prismaClient, state } = makePrisma();
  prismaClient.$transaction = async callback => callback({
    ...prismaClient,
    transportPartner: { findUnique: async () => partner },
    transportPartnerMember: { findUnique: async () => ({ role: "OPERATIONS", isActive: true }) },
    user: { findUnique: async () => applicant },
    serviceZone: { findUnique: async () => zone },
    hubApplication: { findFirst: async () => null, create: async () => { throw new Error("Must not create"); } },
    operationalAuditEvent: { create: async () => { throw new Error("Must not audit"); } },
  });
  const service = createHubApplicationsService({ prismaClient, clock: () => now });
  await assert.rejects(service.submit(validInput, "owner-1"), { code: "PARTNER_OWNER_REQUIRED", statusCode: 403 });
  assert.equal(state.applications.length, 0);
});

test("submitting a hub application records partner, applicant and location data in one transaction", async () => {
  const { prismaClient, state } = makePrisma();
  const service = createHubApplicationsService({ prismaClient, clock: () => now });
  const result = await service.submit(validInput, "owner-1");
  assert.equal(result.application.status, "PENDING");
  assert.equal(result.application.partnerId, "partner-1");
  assert.equal(result.application.applicantUserId, "owner-1");
  assert.equal(state.audits[0].action, "HUB_APPLICATION_SUBMITTED");
});

test("approval creates a pending partner-owned hub and assigns the applicant as manager", async () => {
  const { prismaClient, state } = makePrisma();
  const service = createHubApplicationsService({ prismaClient, clock: () => now });
  const result = await service.approve("application-1", "admin-1");
  assert.equal(result.hubPoint.partnerId, "partner-1");
  assert.equal(result.hubPoint.status, "PENDING");
  assert.equal(result.hubPoint.operatorVerificationStatus, "PENDING");
  assert.equal(state.managers[0].userId, "owner-1");
  assert.equal(state.managers[0].role, "MANAGER");
  assert.equal(result.application.status, "APPROVED");
  assert.equal(state.audits[0].action, "HUB_APPLICATION_APPROVED");
  assert.equal(state.audits[1].action, "HUB_POINT_CREATED_FROM_APPLICATION");
});

test("approval is blocked if the applicant no longer owns the partner", async () => {
  const { prismaClient, state } = makePrisma();
  const tx = {
    ...prismaClient,
    hubApplication: { findUnique: async () => application },
    transportPartnerMember: { findUnique: async () => ({ role: "OWNER", isActive: false }) },
    hubPoint: { create: async () => { throw new Error("Must not create hub"); } },
    hubPointOperator: { upsert: async () => { throw new Error("Must not assign manager"); } },
    operationalAuditEvent: { create: async () => { throw new Error("Must not audit"); } },
  };
  prismaClient.$transaction = async callback => callback(tx);
  const service = createHubApplicationsService({ prismaClient, clock: () => now });
  const result = await service.approve("application-1", "admin-1");
  assert.equal(result.blocker, "PARTNER_OWNER_REQUIRED");
  assert.equal(state.hubs.length, 0);
});

test("rejected applications require a reason and retain the reviewer decision", async () => {
  const { prismaClient, state } = makePrisma();
  const service = createHubApplicationsService({ prismaClient, clock: () => now });
  const result = await service.reject("application-1", "Incomplete operating details", "admin-1");
  assert.equal(result.application.status, "REJECTED");
  assert.equal(result.application.reviewReason, "Incomplete operating details");
  assert.equal(state.audits[0].reason, "Incomplete operating details");
});

test("only the applicant can withdraw a pending application", async () => {
  const { prismaClient, state } = makePrisma();
  const tx = {
    ...prismaClient,
    hubApplication: {
      findFirst: async ({ where }) => where.applicantUserId === "owner-1" ? application : null,
      update: async ({ data }) => ({ ...application, ...data }),
    },
  };
  prismaClient.$transaction = async callback => callback(tx);
  const service = createHubApplicationsService({ prismaClient, clock: () => now });
  const denied = await service.withdraw("application-1", "other-user");
  assert.equal(denied.notFound, true);
  const result = await service.withdraw("application-1", "owner-1");
  assert.equal(result.application.status, "WITHDRAWN");
  assert.equal(state.audits[0].action, "HUB_APPLICATION_WITHDRAWN");
});

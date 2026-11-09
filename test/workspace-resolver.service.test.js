import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceResolver } from "../src/modules/auth/workspace-resolver.service.js";

const user = (role, overrides = {}) => ({
  id: "user-1",
  role,
  status: "ACTIVE",
  ...overrides,
});

function resolverWith({
  driverProfile = null,
  partnerMemberships = [],
  hubMemberships = [],
} = {}) {
  return createWorkspaceResolver({
    prismaClient: {
      driverProfile: { findUnique: async () => driverProfile },
      transportPartnerMember: { findMany: async () => partnerMemberships },
      hubPointOperator: { findMany: async () => hubMemberships },
    },
  });
}

test("resolves non-operational primary workspaces without querying memberships", async () => {
  const resolver = resolverWith();
  for (const [role, key, landingPath] of [
    ["CUSTOMER", "CUSTOMER", "/"],
    ["SUPPORT", "SUPPORT", "/support"],
    ["ADMIN", "ADMIN", "/admin"],
  ]) {
    assert.deepEqual(await resolver.resolve(user(role)), {
      key, status: "READY", reasonCode: null, landingPath,
    });
  }
});

test("Driver workspace remains available but restricted while verification is pending or rejected", async () => {
  for (const verificationStatus of ["PENDING", "REJECTED", "NOT_SUBMITTED"]) {
    const resolver = resolverWith({ driverProfile: { verificationStatus, suspendedAt: null } });
    const result = await resolver.resolve(user("DRIVER"));
    assert.equal(result.key, "DRIVER");
    assert.equal(result.status, "RESTRICTED");
    assert.equal(result.profileStatus, verificationStatus);
    assert.equal(result.landingPath, "/driver");
  }
});

test("Driver workspace is blocked when its required profile is missing or suspended", async () => {
  const missing = await resolverWith().resolve(user("DRIVER"));
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.reasonCode, "DRIVER_PROFILE_REQUIRED");

  const suspended = await resolverWith({
    driverProfile: { verificationStatus: "VERIFIED", suspendedAt: new Date() },
  }).resolve(user("DRIVER"));
  assert.equal(suspended.status, "RESTRICTED");
  assert.equal(suspended.reasonCode, "DRIVER_PROFILE_SUSPENDED");
});

test("verified Driver profile resolves ready without treating workspace readiness as execution authorization", async () => {
  const result = await resolverWith({
    driverProfile: { verificationStatus: "VERIFIED", suspendedAt: null },
  }).resolve(user("DRIVER"));
  assert.equal(result.status, "READY");
  assert.equal(result.profileStatus, "VERIFIED");
});

test("Partner workspace requires an active membership in an active verified partner", async () => {
  const missing = await resolverWith().resolve(user("PARTNER_OPERATOR"));
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.reasonCode, "PARTNER_MEMBERSHIP_REQUIRED");

  const pending = await resolverWith({
    partnerMemberships: [{ partner: { status: "PENDING", verificationStatus: "PENDING" } }],
  }).resolve(user("PARTNER_OPERATOR"));
  assert.equal(pending.status, "RESTRICTED");
  assert.equal(pending.reasonCode, "PARTNER_APPROVAL_PENDING");

  const suspended = await resolverWith({
    partnerMemberships: [{ partner: { status: "SUSPENDED", verificationStatus: "VERIFIED" } }],
  }).resolve(user("PARTNER_OPERATOR"));
  assert.equal(suspended.status, "BLOCKED");
  assert.equal(suspended.reasonCode, "PARTNER_NOT_OPERATIONAL");

  const eligible = await resolverWith({
    partnerMemberships: [
      { partner: { status: "SUSPENDED", verificationStatus: "VERIFIED" } },
      { partner: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
    ],
  }).resolve(user("PARTNER_OPERATOR"));
  assert.equal(eligible.status, "READY");
  assert.equal(eligible.key, "PARTNER");
});

test("Hub workspace requires an active membership in an active verified hub", async () => {
  const missing = await resolverWith().resolve(user("HUB_OPERATOR"));
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.reasonCode, "HUB_MEMBERSHIP_REQUIRED");

  const pending = await resolverWith({
    hubMemberships: [{ hubPoint: { status: "PENDING", operatorVerificationStatus: "PENDING" } }],
  }).resolve(user("HUB_OPERATOR"));
  assert.equal(pending.status, "RESTRICTED");
  assert.equal(pending.reasonCode, "HUB_APPROVAL_PENDING");

  const suspended = await resolverWith({
    hubMemberships: [{ hubPoint: { status: "SUSPENDED", operatorVerificationStatus: "VERIFIED" } }],
  }).resolve(user("HUB_OPERATOR"));
  assert.equal(suspended.status, "BLOCKED");
  assert.equal(suspended.reasonCode, "HUB_NOT_OPERATIONAL");

  const eligible = await resolverWith({
    hubMemberships: [{ hubPoint: { status: "ACTIVE", operatorVerificationStatus: "VERIFIED" } }],
  }).resolve(user("HUB_OPERATOR"));
  assert.equal(eligible.status, "READY");
  assert.equal(eligible.key, "HUB");
});

test("inactive memberships are excluded and never cause Customer fallback", async () => {
  const partner = await resolverWith().resolve(user("PARTNER_OPERATOR"));
  const hub = await resolverWith().resolve(user("HUB_OPERATOR"));
  assert.equal(partner.key, "PARTNER");
  assert.equal(partner.status, "BLOCKED");
  assert.notEqual(partner.key, "CUSTOMER");
  assert.equal(hub.key, "HUB");
  assert.equal(hub.status, "BLOCKED");
  assert.notEqual(hub.key, "CUSTOMER");
});

test("inactive accounts and unsupported roles fail closed", async () => {
  const inactive = await resolverWith().resolve(user("DRIVER", { status: "SUSPENDED" }));
  assert.equal(inactive.status, "BLOCKED");
  assert.equal(inactive.reasonCode, "ACCOUNT_NOT_ACTIVE");

  const unsupported = await resolverWith().resolve(user("UNRECOGNIZED"));
  assert.equal(unsupported.status, "BLOCKED");
  assert.equal(unsupported.key, null);
  assert.equal(unsupported.landingPath, null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createGeographyAdminService } from "../src/modules/geography/geography.admin.service.js";

function prismaMock(overrides = {}) {
  const models = () => ({
    country: { findUnique: async () => null, create: async ({ data }) => ({ id: "country-1", ...data }), update: async ({ data }) => data, count: async () => 0, ...overrides.country },
    state: { findUnique: async () => null, create: async ({ data }) => ({ id: "state-1", ...data }), update: async ({ data }) => data, count: async () => 0, ...overrides.state },
    lGA: { findUnique: async () => null, create: async ({ data }) => ({ id: "lga-1", ...data }), update: async ({ data }) => data, delete: async ({ where }) => where, ...overrides.lGA },
    serviceZone: { count: async () => 0, ...overrides.serviceZone },
  });
  const root = models();
  root.$transaction = async callback => callback({
    ...models(),
    operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
  });
  return root;
}

test("state creation requires an active country, normalizes code and writes an audit event", async () => {
  const prisma = prismaMock({ country: { findUnique: async () => ({ id: "country-1", isActive: true }) } });
  const service = createGeographyAdminService({ prismaClient: prisma });
  const state = await service.createState({ countryId: "country-1", code: "lag", name: "Lagos" }, "admin-1");
  assert.equal(state.code, "LAG");
});

test("state activation is blocked while its country is inactive", async () => {
  const prisma = prismaMock({ state: { findUnique: async () => ({ id: "state-1", country: { isActive: false } }) } });
  const service = createGeographyAdminService({ prismaClient: prisma });
  await assert.rejects(service.setStateActive("state-1", true, "admin-1"), { code: "COUNTRY_INACTIVE", statusCode: 409 });
});

test("state deactivation is blocked while active service zones remain", async () => {
  const prisma = prismaMock({
    state: { findUnique: async () => ({ id: "state-1", country: { isActive: true } }) },
    serviceZone: { count: async () => 1 },
  });
  const service = createGeographyAdminService({ prismaClient: prisma });
  await assert.rejects(service.setStateActive("state-1", false, "admin-1"), { code: "ACTIVE_SERVICE_ZONES_EXIST", statusCode: 409 });
});

test("LGA creation requires active parent geography and normalizes optional code", async () => {
  const prisma = prismaMock({ state: { findUnique: async () => ({ id: "state-1", isActive: true, country: { isActive: true } }) } });
  const service = createGeographyAdminService({ prismaClient: prisma });
  const lga = await service.createLga({ stateId: "state-1", code: "ikeja", name: "Ikeja" }, "admin-1");
  assert.equal(lga.code, "IKEJA");
});

test("an LGA referenced by a service zone cannot be deleted", async () => {
  const prisma = prismaMock({ lGA: { findUnique: async () => ({ id: "lga-1", _count: { zones: 2 } }) } });
  const service = createGeographyAdminService({ prismaClient: prisma });
  await assert.rejects(service.deleteLga("lga-1", "admin-1"), { code: "LGA_IN_USE", statusCode: 409 });
});


test("geography mutations use serializable transactions", async () => {
  let options;
  const prisma = prismaMock();
  prisma.$transaction = async (callback, transactionOptions) => {
    options = transactionOptions;
    return callback({
      ...prisma,
      operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
    });
  };
  const service = createGeographyAdminService({ prismaClient: prisma });

  await service.createCountry({ code: "ng", name: "Nigeria" }, "admin-1");

  assert.deepEqual(options, { isolationLevel: "Serializable" });
});

test("geography mutations retry serialization conflicts up to two times", async () => {
  let attempts = 0;
  const prisma = prismaMock();
  prisma.$transaction = async (callback, transactionOptions) => {
    assert.deepEqual(transactionOptions, { isolationLevel: "Serializable" });
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("Serialization conflict");
      error.code = "P2034";
      throw error;
    }
    return callback({
      ...prisma,
      operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
    });
  };
  const service = createGeographyAdminService({ prismaClient: prisma });

  await service.createCountry({ code: "ng", name: "Nigeria" }, "admin-1");

  assert.equal(attempts, 3);
});

test("geography mutations do not retry non-serialization failures", async () => {
  let attempts = 0;
  const failure = new Error("Database unavailable");
  const prisma = prismaMock();
  prisma.$transaction = async () => {
    attempts += 1;
    throw failure;
  };
  const service = createGeographyAdminService({ prismaClient: prisma });

  await assert.rejects(service.createCountry({ code: "ng", name: "Nigeria" }, "admin-1"), failure);
  assert.equal(attempts, 1);
});

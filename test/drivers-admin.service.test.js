import test from "node:test";
import assert from "node:assert/strict";
import { createDriversAdminService } from "../src/modules/drivers/drivers.admin.service.js";
import { driverAdminListSchema, vehicleAdminListSchema } from "../src/modules/drivers/drivers.admin.validators.js";

test("driver admin list applies verification filter and pagination", async () => {
  let findArgs, countArgs;
  const prismaClient = { driverProfile: {
    findMany: async args => { findArgs = args; return [{ id: "driver-1" }]; },
    count: async args => { countArgs = args; return 51; },
  } };
  const service = createDriversAdminService({ prismaClient });
  const query = driverAdminListSchema.parse({ verificationStatus: "PENDING", page: "2", limit: "25" });
  const result = await service.listDrivers(query);
  assert.deepEqual(findArgs.where, { verificationStatus: "PENDING" });
  assert.equal(findArgs.skip, 25);
  assert.equal(findArgs.take, 25);
  assert.deepEqual(countArgs.where, { verificationStatus: "PENDING" });
  assert.equal(result.totalPages, 3);
});

test("vehicle admin list converts isActive query string to boolean", async () => {
  let findArgs;
  const prismaClient = { vehicle: {
    findMany: async args => { findArgs = args; return []; },
    count: async () => 0,
  } };
  const service = createDriversAdminService({ prismaClient });
  const query = vehicleAdminListSchema.parse({ verificationStatus: "VERIFIED", isActive: "false" });
  const result = await service.listVehicles(query);
  assert.deepEqual(findArgs.where, { verificationStatus: "VERIFIED", isActive: false });
  assert.equal(result.total, 0);
});

test("driver admin list rejects invalid verification status", () => {
  assert.equal(driverAdminListSchema.safeParse({ verificationStatus: "SUSPENDED" }).success, false);
});

test("vehicle admin list rejects unbounded page sizes", () => {
  assert.equal(vehicleAdminListSchema.safeParse({ limit: "1000" }).success, false);
});

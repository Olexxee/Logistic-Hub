import test from "node:test";
import assert from "node:assert/strict";
import { createDriversService } from "../src/modules/drivers/drivers.service.js";

test("suspended drivers cannot restore availability", async () => {
  const service = createDriversService({ prismaClient: {
    driverProfile: { findUnique: async () => ({ id: "driver-1", verificationStatus: "VERIFIED", suspendedAt: new Date(), vehicles: [], coverage: [] }) },
  } });
  await assert.rejects(
    () => service.setAvailability({ userId: "user-1", input: { isOnline: true, isAvailable: true } }),
    error => error.statusCode === 403 && error.message.includes("suspended"),
  );
});

test("suspended drivers cannot publish location updates", async () => {
  const service = createDriversService({ prismaClient: {
    driverProfile: { findUnique: async () => ({ id: "driver-1", verificationStatus: "VERIFIED", suspendedAt: new Date(), isOnline: true }) },
  } });
  await assert.rejects(
    () => service.recordLocation({ userId: "user-1", input: { latitude: 6.5, longitude: 3.4 } }),
    error => error.statusCode === 403,
  );
});

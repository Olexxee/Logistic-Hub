import test from "node:test";
import assert from "node:assert/strict";
import {
  driverAvailabilitySchema,
  driverLocationSchema,
  driverOnboardingSchema,
  driverVerificationSchema,
} from "../src/modules/drivers/drivers.schemas.js";

test("driver onboarding validates vehicle type and bounded service radius", () => {
  assert.equal(driverOnboardingSchema.safeParse({
    serviceRadiusMeters: 5000,
    vehicle: { type: "MOTORCYCLE", registrationPlate: "ABC-123" },
  }).success, true);
  assert.equal(driverOnboardingSchema.safeParse({
    serviceRadiusMeters: 500000,
    vehicle: { type: "MOTORCYCLE" },
  }).success, false);
});

test("driver cannot be available while offline", () => {
  assert.equal(driverAvailabilitySchema.safeParse({ isOnline: true, isAvailable: true }).success, true);
  assert.equal(driverAvailabilitySchema.safeParse({ isOnline: false, isAvailable: true }).success, false);
});

test("driver location coordinates are bounded", () => {
  assert.equal(driverLocationSchema.safeParse({ latitude: 6.5, longitude: 3.4 }).success, true);
  assert.equal(driverLocationSchema.safeParse({ latitude: 120, longitude: 3.4 }).success, false);
});

test("only explicit verification decisions are accepted", () => {
  assert.equal(driverVerificationSchema.safeParse({ verificationStatus: "VERIFIED" }).success, true);
  assert.equal(driverVerificationSchema.safeParse({ verificationStatus: "PENDING" }).success, false);
});

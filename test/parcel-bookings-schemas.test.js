import test from "node:test";
import assert from "node:assert/strict";
import { createParcelBookingSchema, idempotencyKeySchema } from "../src/modules/parcels/parcel-bookings.schemas.js";

const validBooking = {
  pickupServiceZoneId: "zone_ikeja",
  destinationServiceZoneId: "zone_yaba",
  pickupAddress: "12 Allen Avenue, Ikeja, Lagos",
  pickup: { latitude: 6.6018, longitude: 3.3515 },
  destinationAddress: "10 Herbert Macaulay Way, Yaba, Lagos",
  destination: { latitude: 6.5095, longitude: 3.3711 },
  recipientName: "Recipient Name",
  recipientPhone: "+2348012345678",
  parcelCategory: "documents",
  parcelSize: "small",
};

test("parcel draft schema accepts a valid booking and rejects client-owned lifecycle fields", () => {
  assert.equal(createParcelBookingSchema.safeParse(validBooking).success, true);
  const { pickupServiceZoneId, destinationServiceZoneId, ...withoutZoneHints } = validBooking;
  assert.equal(createParcelBookingSchema.safeParse(withoutZoneHints).success, true);
  assert.equal(createParcelBookingSchema.safeParse({ ...validBooking, status: "COMPLETED" }).success, false);
  assert.equal(createParcelBookingSchema.safeParse({
    ...validBooking,
    pickup: { latitude: 95, longitude: 3.3 },
  }).success, false);
});

test("declared value is an integer minor-unit string, not a floating-point naira amount", () => {
  assert.equal(createParcelBookingSchema.safeParse({ ...validBooking, declaredValueMinor: "12500" }).success, true);
  assert.equal(createParcelBookingSchema.safeParse({ ...validBooking, declaredValueMinor: "125.50" }).success, false);
});

test("idempotency key requires a safe bounded value", () => {
  assert.equal(idempotencyKeySchema.safeParse("booking-create-0001").success, true);
  assert.equal(idempotencyKeySchema.safeParse("bad key").success, false);
  assert.equal(idempotencyKeySchema.safeParse("short").success, false);
});

test("canonical package payload accepts multiple declared packages with measurements", () => {
  const { parcelCategory, parcelDescription, parcelSize, ...base } = validBooking;
  const parsed = createParcelBookingSchema.safeParse({
    ...base,
    packages: [
      { packageCategory: "electronics", weightGrams: 1250, lengthMm: 240, widthMm: 180, heightMm: 90, declaredValueMinor: "250000" },
      { packageCategory: "documents", weightGrams: 300 },
    ],
  });
  assert.equal(parsed.success, true);
});

test("package dimensions are all-or-none and customer cannot set assessment metadata", () => {
  const { parcelCategory, parcelDescription, parcelSize, ...base } = validBooking;
  assert.equal(createParcelBookingSchema.safeParse({
    ...base,
    packages: [{ packageCategory: "electronics", lengthMm: 20 }],
  }).success, false);
  assert.equal(createParcelBookingSchema.safeParse({
    ...base,
    packages: [{ packageCategory: "electronics", assessmentStatus: "MEASURED" }],
  }).success, false);
});

test("legacy single-package booking remains compatible and can include measurements", () => {
  assert.equal(createParcelBookingSchema.safeParse({
    ...validBooking, weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 80,
  }).success, true);
  assert.equal(createParcelBookingSchema.safeParse({
    ...validBooking, weightGrams: 500, lengthMm: 200,
  }).success, false);
});

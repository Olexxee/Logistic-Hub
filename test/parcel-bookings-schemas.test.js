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
  assert.equal(createParcelBookingSchema.safeParse(({ pickupServiceZoneId, destinationServiceZoneId, ...withoutZoneHints }) => withoutZoneHints)(validBooking)).success, true);
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

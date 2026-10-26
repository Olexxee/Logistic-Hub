import test from "node:test";
import assert from "node:assert/strict";
import { createRideBookingSchema, rideIdempotencyKeySchema } from "../src/modules/rides/ride-bookings.schemas.js";

const valid = {
  pickupServiceZoneId: "zone-a",
  destinationServiceZoneId: "zone-b",
  pickupAddress: "12 Marina Road, Lagos",
  pickup: { latitude: 6.45, longitude: 3.39 },
  destinationAddress: "Ikeja City Mall, Lagos",
  destination: { latitude: 6.62, longitude: 3.35 },
  vehicleType: "CAR",
};

test("ride booking schema accepts valid route and vehicle details", () => {
  assert.equal(createRideBookingSchema.safeParse(valid).success, true);
});

test("ride booking schema rejects out-of-range coordinates and unknown fields", () => {
  assert.equal(createRideBookingSchema.safeParse({ ...valid, pickup: { latitude: 91, longitude: 3.39 } }).success, false);
  assert.equal(createRideBookingSchema.safeParse({ ...valid, admin: true }).success, false);
});

test("ride booking idempotency key is bounded and restricted to safe characters", () => {
  assert.equal(rideIdempotencyKeySchema.safeParse("ride-create-1234").success, true);
  assert.equal(rideIdempotencyKeySchema.safeParse("bad key").success, false);
  assert.equal(rideIdempotencyKeySchema.safeParse("short").success, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createParcelBookingsService } from "../src/modules/parcels/parcel-bookings.service.js";
import { createRideBookingsService } from "../src/modules/rides/ride-bookings.service.js";
import { createAssignmentsService } from "../src/modules/assignments/assignments.service.js";

test("a customer cannot read another customer's parcel booking by changing the booking ID", async () => {
  const service = createParcelBookingsService({
    repository: { findById: async () => ({ id: "parcel-1", senderId: "customer-owner" }) },
  });
  await assert.rejects(
    service.getVisibleBooking({
      bookingId: "parcel-1",
      user: { id: "customer-attacker", role: "CUSTOMER" },
    }),
    error => error.statusCode === 403,
  );
});

test("ADMIN and SUPPORT retain authorized operational visibility of parcel bookings", async () => {
  const service = createParcelBookingsService({
    repository: { findById: async () => ({ id: "parcel-1", senderId: "customer-owner" }) },
  });
  for (const role of ["ADMIN", "SUPPORT"]) {
    const result = await service.getVisibleBooking({
      bookingId: "parcel-1",
      user: { id: "operator-1", role },
    });
    assert.equal(result.id, "parcel-1");
  }
});

test("a customer cannot read another passenger's ride booking by changing the booking ID", async () => {
  const service = createRideBookingsService({
    repository: { findById: async () => ({ id: "ride-1", passengerId: "passenger-owner" }) },
  });
  await assert.rejects(
    service.getVisibleRide({
      rideBookingId: "ride-1",
      user: { id: "passenger-attacker", role: "CUSTOMER" },
    }),
    error => error.statusCode === 403,
  );
});

test("a driver cannot transition or inspect another driver's assignment", async () => {
  const assignment = {
    id: "assignment-1",
    status: "ACCEPTED",
    driverProfile: { userId: "driver-owner" },
    parcelBooking: { senderId: "customer-owner" },
    rideBooking: null,
  };
  const service = createAssignmentsService({
    prismaClient: {
      driverAssignment: { findUnique: async () => assignment },
    },
  });

  await assert.rejects(
    service.markArrived({ assignmentId: "assignment-1", userId: "driver-attacker" }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.location({
      assignmentId: "assignment-1",
      user: { id: "driver-attacker", role: "DRIVER" },
    }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.issueCode({
      assignmentId: "assignment-1",
      user: { id: "customer-attacker", role: "CUSTOMER" },
      action: "PICKUP",
    }),
    error => error.statusCode === 403,
  );
});

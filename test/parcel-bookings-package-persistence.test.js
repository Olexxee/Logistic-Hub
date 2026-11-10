import test from "node:test";
import assert from "node:assert/strict";
import { createParcelBookingsRepository } from "../src/modules/parcels/parcel-bookings.repository.js";

test("booking and customer-declared package facts are persisted atomically with the creation event", async () => {
  let bookingCreateArgs;
  let eventCreateArgs;
  const prismaClient = {
    $transaction: async callback => callback({
      parcelBooking: {
        create: async args => {
          bookingCreateArgs = args;
          return { id: "booking_1", ...args.data, parcelPackages: args.data.parcelPackages.create };
        },
      },
      bookingEvent: {
        create: async args => { eventCreateArgs = args; },
      },
    }),
  };
  const repository = createParcelBookingsRepository({ prismaClient });
  const packages = [{
    packageSequence: 1,
    packageCategory: "electronics",
    description: "Laptop",
    weightGrams: 1450,
    lengthMm: 340,
    widthMm: 240,
    heightMm: 30,
    declaredValueMinor: 250000n,
    assessmentStatus: "DECLARED",
    assessmentSource: "CUSTOMER_DECLARED",
  }];
  const booking = await repository.createWithEvent(
    { publicReference: "LH-PCL-TEST", senderId: "customer_1" },
    { actorUserId: "customer_1", metadata: { packageCount: 1 }, packages },
  );

  assert.deepEqual(bookingCreateArgs.data.parcelPackages.create, packages);
  assert.equal(bookingCreateArgs.include.parcelPackages.orderBy.packageSequence, "asc");
  assert.equal(eventCreateArgs.data.parcelBookingId, "booking_1");
  assert.equal(eventCreateArgs.data.actorUserId, "customer_1");
  assert.deepEqual(booking.parcelPackages, packages);
});

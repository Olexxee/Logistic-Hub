import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const enabled = process.env.RUN_POSTGRES_INTEGRITY_TESTS === "true";
const prisma = new PrismaClient();
test.after(async () => prisma.$disconnect());

function suffix() {
  return randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}

test("PostgreSQL rejects a service zone whose LGA belongs to another state", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let originState;
  let otherState;
  let lga;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Test Country ${tag}` } });
    originState = await prisma.state.create({
      data: { countryId: country.id, code: `A${tag}`, name: `Origin State ${tag}` },
    });
    otherState = await prisma.state.create({
      data: { countryId: country.id, code: `B${tag}`, name: `Other State ${tag}` },
    });
    lga = await prisma.lGA.create({
      data: { stateId: originState.id, code: `L${tag}`, name: `Test LGA ${tag}` },
    });

    await assert.rejects(
      prisma.serviceZone.create({
        data: {
          stateId: otherState.id,
          lgaId: lga.id,
          code: `Z${tag}`,
          name: `Invalid Cross-State Zone ${tag}`,
        },
      }),
    );
  } finally {
    if (originState && otherState) {
      await prisma.serviceZone.deleteMany({ where: { stateId: { in: [originState.id, otherState.id] } } });
    }
    if (lga) await prisma.lGA.deleteMany({ where: { id: lga.id } });
    if (originState) await prisma.state.deleteMany({ where: { id: originState.id } });
    if (otherState) await prisma.state.deleteMany({ where: { id: otherState.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

test("PostgreSQL rejects invalid booking coordinates and inconsistent accepted totals", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let user;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Test Country ${tag}` } });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Test State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Test Zone ${tag}` },
    });
    user = await prisma.user.create({ data: { fullName: `Test Sender ${tag}` } });

    await assert.rejects(
      prisma.parcelBooking.create({
        data: {
          publicReference: `TEST-${tag}`,
          senderId: user.id,
          pickupServiceZoneId: zone.id,
          destinationServiceZoneId: zone.id,
          pickupAddress: "Invalid test coordinate",
          pickupLatitude: 999,
          pickupLongitude: 3.4,
          destinationAddress: "Test destination",
          destinationLatitude: 6.5,
          destinationLongitude: 3.4,
          recipientName: "Test Recipient",
          recipientPhone: "+2348000000000",
          parcelCategory: "DOCUMENT",
          parcelSize: "SMALL",
          connectionFeeMinor: 300n,
          pricingSnapshot: {},
        },
      }),
    );

    await assert.rejects(
      prisma.parcelBooking.create({
        data: {
          publicReference: `TOTAL-${tag}`,
          senderId: user.id,
          pickupServiceZoneId: zone.id,
          destinationServiceZoneId: zone.id,
          pickupAddress: "Test pickup",
          pickupLatitude: 6.5,
          pickupLongitude: 3.4,
          destinationAddress: "Test destination",
          destinationLatitude: 6.6,
          destinationLongitude: 3.5,
          recipientName: "Test Recipient",
          recipientPhone: "+2348000000000",
          parcelCategory: "DOCUMENT",
          parcelSize: "SMALL",
          driverFareMinor: 4000n,
          connectionFeeMinor: 300n,
          otherChargesMinor: 0n,
          customerPayableMinor: 9999n,
          pricingSnapshot: {},
        },
      }),
    );
  } finally {
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

test("PostgreSQL enforces split allocation and payment reservation integrity", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let sender;
  let driverUser;
  let driverProfile;
  let booking;
  let settlementAccount;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Test Country ${tag}` } });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Test State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Test Zone ${tag}` },
    });
    sender = await prisma.user.create({ data: { fullName: `Test Sender ${tag}` } });
    driverUser = await prisma.user.create({ data: { fullName: `Test Driver ${tag}` } });
    driverProfile = await prisma.driverProfile.create({ data: { userId: driverUser.id } });
    booking = await prisma.parcelBooking.create({
      data: {
        publicReference: `SPLIT-${tag}`,
        senderId: sender.id,
        pickupServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        pickupAddress: "Test pickup",
        pickupLatitude: 6.5,
        pickupLongitude: 3.4,
        destinationAddress: "Test destination",
        destinationLatitude: 6.6,
        destinationLongitude: 3.5,
        recipientName: "Test Recipient",
        recipientPhone: "+2348000000000",
        parcelCategory: "DOCUMENT",
        parcelSize: "SMALL",
        connectionFeeMinor: 300n,
        pricingSnapshot: {},
      },
    });
    settlementAccount = await prisma.driverSettlementAccount.create({
      data: {
        driverProfileId: driverProfile.id,
        externalAccountRef: `TEST-${tag}`,
      },
    });

    await assert.rejects(
      prisma.paymentAttempt.create({
        data: {
          parcelBookingId: booking.id,
          idempotencyKey: `SPLIT-KEY-${tag}`,
          amountMinor: 4300n,
          driverAllocationMinor: 4000n,
          platformAllocationMinor: 200n,
          driverSettlementAccountId: settlementAccount.id,
          splitConfigurationSnapshot: { version: 1, purpose: "integrity-test" },
        },
      }),
    );

    await assert.rejects(
      prisma.driverAssignment.create({
        data: {
          parcelBookingId: booking.id,
          driverProfileId: driverProfile.id,
          agreedFareMinor: 4000n,
        },
      }),
    );
  } finally {
    if (booking) {
      await prisma.driverAssignment.deleteMany({ where: { parcelBookingId: booking.id } });
      await prisma.paymentAttempt.deleteMany({ where: { parcelBookingId: booking.id } });
    }
    if (settlementAccount) {
      await prisma.driverSettlementAccount.deleteMany({ where: { id: settlementAccount.id } });
    }
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (driverProfile) await prisma.driverProfile.deleteMany({ where: { id: driverProfile.id } });
    const userIds = [sender?.id, driverUser?.id].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

test("PostgreSQL integrity tests are explicitly gated outside the disposable CI database", { skip: enabled }, () => {
  assert.equal(enabled, false);
});


test("PostgreSQL serializes concurrent active assignment reservations by booking and driver", { skip: !enabled }, async () => {
  const tag = suffix();
  const now = new Date();
  const paymentExpiresAt = new Date(now.getTime() + 15 * 60_000);
  let country;
  let state;
  let zone;
  let sender;
  let driverUserA;
  let driverUserB;
  let driverA;
  let driverB;
  let bookingA;
  let bookingB;
  let legA;
  let legB;

  const createReservation = ({ bookingId, legId, driverProfileId }) => prisma.driverAssignment.create({
    data: {
      parcelBookingId: bookingId,
      deliveryLegId: legId,
      driverProfileId,
      status: "AWAITING_PAYMENT",
      agreedFareMinor: 1000n,
      reservedAt: now,
      paymentExpiresAt,
    },
  });

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Reservation Test Country ${tag}` } });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Reservation Test State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Reservation Test Zone ${tag}` },
    });
    sender = await prisma.user.create({ data: { fullName: `Reservation Sender ${tag}` } });
    driverUserA = await prisma.user.create({ data: { fullName: `Reservation Driver A ${tag}` } });
    driverUserB = await prisma.user.create({ data: { fullName: `Reservation Driver B ${tag}` } });
    driverA = await prisma.driverProfile.create({ data: { userId: driverUserA.id } });
    driverB = await prisma.driverProfile.create({ data: { userId: driverUserB.id } });

    const createBooking = (reference) => prisma.parcelBooking.create({
      data: {
        publicReference: reference,
        senderId: sender.id,
        pickupServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        pickupAddress: "Reservation test pickup",
        pickupLatitude: 6.5,
        pickupLongitude: 3.4,
        destinationAddress: "Reservation test destination",
        destinationLatitude: 6.6,
        destinationLongitude: 3.5,
        recipientName: "Reservation Recipient",
        recipientPhone: "+2348000000000",
        parcelCategory: "DOCUMENT",
        parcelSize: "SMALL",
        connectionFeeMinor: 300n,
        pricingSnapshot: {},
      },
    });
    bookingA = await createBooking(`RACE-A-${tag}`);
    bookingB = await createBooking(`RACE-B-${tag}`);

    const createLeg = (bookingId) => prisma.deliveryLeg.create({
      data: {
        parcelBookingId: bookingId,
        sequence: 1,
        type: "LOCAL_PICKUP",
        status: "READY_FOR_ASSIGNMENT",
        originServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
      },
    });
    legA = await createLeg(bookingA.id);
    legB = await createLeg(bookingB.id);

    // Two different drivers race to reserve the same booking/leg.
    // The booking-level partial unique index must permit exactly one winner.
    const bookingRace = await Promise.allSettled([
      createReservation({ bookingId: bookingA.id, legId: legA.id, driverProfileId: driverA.id }),
      createReservation({ bookingId: bookingA.id, legId: legA.id, driverProfileId: driverB.id }),
    ]);
    const bookingRaceWinners = bookingRace.filter((result) => result.status === "fulfilled");
    const bookingRaceLosers = bookingRace.filter((result) => result.status === "rejected");
    assert.equal(bookingRaceWinners.length, 1);
    assert.equal(bookingRaceLosers.length, 1);
    assert.equal(bookingRaceLosers[0].reason.code, "P2002");
    assert.equal(await prisma.driverAssignment.count({
      where: { parcelBookingId: bookingA.id, status: "AWAITING_PAYMENT" },
    }), 1);
    assert.equal(await prisma.driverAssignment.count({
      where: { deliveryLegId: legA.id, status: "AWAITING_PAYMENT" },
    }), 1);

    await prisma.driverAssignment.deleteMany({ where: { parcelBookingId: bookingA.id } });

    // One driver races to reserve two different bookings/legs.
    // The driver-level partial unique index must permit exactly one winner.
    const driverRace = await Promise.allSettled([
      createReservation({ bookingId: bookingA.id, legId: legA.id, driverProfileId: driverA.id }),
      createReservation({ bookingId: bookingB.id, legId: legB.id, driverProfileId: driverA.id }),
    ]);
    const driverRaceWinners = driverRace.filter((result) => result.status === "fulfilled");
    const driverRaceLosers = driverRace.filter((result) => result.status === "rejected");
    assert.equal(driverRaceWinners.length, 1);
    assert.equal(driverRaceLosers.length, 1);
    assert.equal(driverRaceLosers[0].reason.code, "P2002");
    assert.equal(await prisma.driverAssignment.count({
      where: { driverProfileId: driverA.id, status: "AWAITING_PAYMENT" },
    }), 1);
  } finally {
    const bookingIds = [bookingA?.id, bookingB?.id].filter(Boolean);
    if (bookingIds.length) await prisma.driverAssignment.deleteMany({ where: { parcelBookingId: { in: bookingIds } } });
    const legIds = [legA?.id, legB?.id].filter(Boolean);
    if (legIds.length) await prisma.deliveryLeg.deleteMany({ where: { id: { in: legIds } } });
    if (bookingIds.length) await prisma.parcelBooking.deleteMany({ where: { id: { in: bookingIds } } });
    const driverIds = [driverA?.id, driverB?.id].filter(Boolean);
    if (driverIds.length) await prisma.driverProfile.deleteMany({ where: { id: { in: driverIds } } });
    const userIds = [sender?.id, driverUserA?.id, driverUserB?.id].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

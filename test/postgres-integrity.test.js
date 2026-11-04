import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createDriverAssignmentExpiryWorker } from "../src/shared/jobs/driver-assignment-expiry.service.js";
import { createPaymentsRepository } from "../src/modules/payments/payments.repository.js";

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


test("payment initialization and unpaid-reservation expiry serialize on the assignment row", { skip: !enabled }, async () => {
  const tag = suffix();
  const now = new Date();
  const paymentExpiresAt = new Date(now.getTime() + 60_000);
  const expiryClock = new Date(now.getTime() + 61_000);
  let country;
  let state;
  let zone;
  let sender;
  let driverUser;
  let driverProfile;
  let booking;
  let leg;
  let offer;
  let assignment;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Expiry Race Country ${tag}` } });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Expiry Race State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Expiry Race Zone ${tag}` },
    });
    sender = await prisma.user.create({ data: { fullName: `Expiry Race Sender ${tag}` } });
    driverUser = await prisma.user.create({ data: { fullName: `Expiry Race Driver ${tag}` } });
    driverProfile = await prisma.driverProfile.create({ data: { userId: driverUser.id } });
    booking = await prisma.parcelBooking.create({
      data: {
        publicReference: `EXPIRY-RACE-${tag}`,
        senderId: sender.id,
        pickupServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        status: "AWAITING_PAYMENT",
        paymentStatus: "INITIALIZED",
        pickupAddress: "Expiry race pickup",
        pickupLatitude: 6.5,
        pickupLongitude: 3.4,
        destinationAddress: "Expiry race destination",
        destinationLatitude: 6.6,
        destinationLongitude: 3.5,
        recipientName: "Expiry Race Recipient",
        recipientPhone: "+2348000000000",
        parcelCategory: "DOCUMENT",
        parcelSize: "SMALL",
        connectionFeeMinor: 300n,
        pricingSnapshot: {},
      },
    });
    leg = await prisma.deliveryLeg.create({
      data: {
        parcelBookingId: booking.id,
        sequence: 1,
        type: "DIRECT",
        status: "AWAITING_PAYMENT",
        originServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
      },
    });
    offer = await prisma.deliveryLegOffer.create({
      data: {
        deliveryLegId: leg.id,
        driverProfileId: driverProfile.id,
        status: "ACCEPTED",
        proposedFareMinor: 1000n,
        currency: "NGN",
        expiresAt: paymentExpiresAt,
        respondedAt: now,
      },
    });
    assignment = await prisma.driverAssignment.create({
      data: {
        parcelBookingId: booking.id,
        deliveryLegId: leg.id,
        driverProfileId: driverProfile.id,
        status: "AWAITING_PAYMENT",
        agreedFareMinor: 1000n,
        currency: "NGN",
        reservedAt: now,
        paymentExpiresAt,
      },
    });

    const expiryWorker = createDriverAssignmentExpiryWorker({
      prismaClient: prisma,
      clock: () => expiryClock,
    });
    const paymentsRepository = createPaymentsRepository(prisma);
    const [expiryResult, paymentResult] = await Promise.allSettled([
      expiryWorker.runOnce(),
      paymentsRepository.createAttempt({
        parcelBookingId: booking.id,
        provider: "PAYSTACK",
        providerReference: `EXPIRY-RACE-${tag}`,
        idempotencyKey: `EXPIRY-RACE-KEY-${tag}`,
        status: "INITIALIZED",
        amountMinor: 1300n,
        currency: "NGN",
      }),
    ]);

    const finalAssignment = await prisma.driverAssignment.findUnique({ where: { id: assignment.id } });
    const finalLeg = await prisma.deliveryLeg.findUnique({ where: { id: leg.id } });
    const attempts = await prisma.paymentAttempt.findMany({ where: { parcelBookingId: booking.id } });

    if (finalAssignment.status === "FAILED") {
      assert.equal(paymentResult.status, "rejected");
      assert.equal(paymentResult.reason.code, "ASSIGNMENT_RESERVATION_EXPIRED");
      assert.equal(finalLeg.status, "READY_FOR_ASSIGNMENT");
      assert.equal(attempts.length, 0);
    } else {
      assert.equal(finalAssignment.status, "AWAITING_PAYMENT");
      assert.equal(paymentResult.status, "fulfilled");
      assert.equal(finalLeg.status, "AWAITING_PAYMENT");
      assert.equal(attempts.length, 1);
    }
    assert.ok(expiryResult.status === "fulfilled");
  } finally {
    if (assignment) await prisma.driverAssignment.deleteMany({ where: { id: assignment.id } });
    if (offer) await prisma.deliveryLegOffer.deleteMany({ where: { id: offer.id } });
    if (leg) await prisma.deliveryLeg.deleteMany({ where: { id: leg.id } });
    if (booking) {
      await prisma.paymentAttempt.deleteMany({ where: { parcelBookingId: booking.id } });
      await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    }
    if (driverProfile) await prisma.driverProfile.deleteMany({ where: { id: driverProfile.id } });
    const userIds = [sender?.id, driverUser?.id].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

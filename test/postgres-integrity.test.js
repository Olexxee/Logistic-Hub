import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createDriverAssignmentExpiryWorker } from "../src/shared/jobs/driver-assignment-expiry.service.js";
import { createPaymentsRepository } from "../src/modules/payments/payments.repository.js";
import { createIntegrationWebhookOperationsService } from "../src/modules/integrations/integration-webhook-operations.service.js";

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
        driverFareMinor: 1000n,
        connectionFeeMinor: 300n,
        customerPayableMinor: 1300n,
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
test("PostgreSQL enforces integration-owned booking identity and normalized package constraints", { skip: !enabled }, async () => {
  const tag = suffix();
  let country; let state; let zone; let client; let booking; let dualOwnerUser;

  const bookingData = (overrides = {}) => ({
    publicReference: `INTEGRATION-${tag}`, integrationClientId: client.id,
    pickupServiceZoneId: zone.id, destinationServiceZoneId: zone.id,
    pickupAddress: "Integration test pickup", pickupLatitude: 6.5, pickupLongitude: 3.4,
    destinationAddress: "Integration test destination", destinationLatitude: 6.6, destinationLongitude: 3.5,
    recipientName: "Integration Recipient", recipientPhone: "+2348000000000",
    parcelCategory: null, parcelSize: null, connectionFeeMinor: 0n,
    pricingSnapshot: { source: "integration-test" }, ...overrides,
  });

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Integration Test Country ${tag}` } });
    state = await prisma.state.create({ data: { countryId: country.id, code: `S${tag}`, name: `Integration Test State ${tag}` } });
    zone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `Z${tag}`, name: `Integration Test Zone ${tag}` } });
    client = await prisma.integrationClient.create({ data: { code: `TEST_CLIENT_${tag}`, name: `Integration Test Client ${tag}` } });

    booking = await prisma.parcelBooking.create({ data: bookingData() });
    assert.equal(booking.senderId, null);
    assert.equal(booking.integrationClientId, client.id);
    assert.equal(booking.parcelCategory, null);
    assert.equal(booking.parcelSize, null);

    await prisma.parcelBookingPackage.create({
      data: {
        parcelBookingId: booking.id, packageSequence: 0, externalPackageRef: "package-A", packageCategory: "carton",
        weightGrams: 1200, lengthMm: 300, widthMm: 200, heightMm: 100,
        declaredValueMinor: 50000n, assessmentStatus: "DECLARED",
        assessmentSource: "INTEGRATOR_DECLARED", assessmentConfidence: 0.92,
      },
    });

    await assert.rejects(prisma.parcelBooking.create({
      data: bookingData({ publicReference: `OWNERLESS-${tag}`, integrationClientId: null }),
    }));
    await assert.rejects(prisma.parcelBooking.create({
      data: bookingData({
        publicReference: `DUAL-OWNER-${tag}`,
        senderId: (dualOwnerUser = await prisma.user.create({ data: { fullName: `Dual Owner User ${tag}` } })).id,
      }),
    }));
    await assert.rejects(prisma.parcelBookingPackage.create({
      data: { parcelBookingId: booking.id, packageSequence: 1, externalPackageRef: "bad-weight", packageCategory: "carton", weightGrams: 0 },
    }));
    await assert.rejects(prisma.parcelBookingPackage.create({
      data: { parcelBookingId: booking.id, packageSequence: 2, externalPackageRef: "bad-value", packageCategory: "carton", declaredValueMinor: -1n },
    }));
    await assert.rejects(prisma.parcelBookingPackage.create({
      data: { parcelBookingId: booking.id, packageSequence: 3, externalPackageRef: "bad-confidence", packageCategory: "carton", assessmentConfidence: 1.01 },
    }));
  } finally {
    if (booking) await prisma.parcelBookingPackage.deleteMany({ where: { parcelBookingId: booking.id } });
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (client) await prisma.integrationClient.deleteMany({ where: { id: client.id } });
    if (dualOwnerUser) await prisma.user.deleteMany({ where: { id: dualOwnerUser.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});


test("PostgreSQL enforces concurrent integration idempotency and external-reference uniqueness and rolls back both atomically", { skip: !enabled }, async () => {
  const tag = suffix();
  let client;
  const operation = "integration.shipment.create";
  const idempotencyKey = `shipment-${tag}`;
  const externalReference = `ORDER-${tag}`;

  try {
    client = await prisma.integrationClient.create({
      data: { code: `test-${tag.toLowerCase()}`, name: `Integration Test ${tag}`, scopes: ["shipments:write"] },
    });

    const idempotencyWrites = await Promise.allSettled([
      prisma.integrationIdempotencyRecord.create({
        data: { clientId: client.id, operation, idempotencyKey, payloadHash: "hash-a" },
      }),
      prisma.integrationIdempotencyRecord.create({
        data: { clientId: client.id, operation, idempotencyKey, payloadHash: "hash-b" },
      }),
    ]);
    assert.equal(idempotencyWrites.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(idempotencyWrites.filter(result => result.status === "rejected" && result.reason?.code === "P2002").length, 1);

    const externalReferenceWrites = await Promise.allSettled([
      prisma.integrationExternalReference.create({
        data: {
          clientId: client.id, resourceType: "SHIPMENT", externalReference,
          internalResourceType: "ParcelBooking", internalResourceId: `booking-a-${tag}`,
        },
      }),
      prisma.integrationExternalReference.create({
        data: {
          clientId: client.id, resourceType: "SHIPMENT", externalReference,
          internalResourceType: "ParcelBooking", internalResourceId: `booking-b-${tag}`,
        },
      }),
    ]);
    assert.equal(externalReferenceWrites.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(externalReferenceWrites.filter(result => result.status === "rejected" && result.reason?.code === "P2002").length, 1);

    const rollbackKey = `rollback-${tag}`;
    const rollbackReference = `ROLLBACK-${tag}`;
    await assert.rejects(
      prisma.$transaction(async tx => {
        await tx.integrationIdempotencyRecord.create({
          data: { clientId: client.id, operation, idempotencyKey: rollbackKey, payloadHash: "rollback-hash" },
        });
        await tx.integrationExternalReference.create({
          data: {
            clientId: client.id, resourceType: "SHIPMENT", externalReference: rollbackReference,
            internalResourceType: "ParcelBooking", internalResourceId: `rollback-booking-${tag}`,
          },
        });
        throw new Error("intentional transaction rollback");
      }),
      /intentional transaction rollback/,
    );

    assert.equal(await prisma.integrationIdempotencyRecord.count({
      where: { clientId: client.id, operation, idempotencyKey: rollbackKey },
    }), 0);
    assert.equal(await prisma.integrationExternalReference.count({
      where: { clientId: client.id, resourceType: "SHIPMENT", externalReference: rollbackReference },
    }), 0);
  } finally {
    if (client) {
      await prisma.integrationExternalReference.deleteMany({ where: { clientId: client.id } });
      await prisma.integrationIdempotencyRecord.deleteMany({ where: { clientId: client.id } });
      await prisma.integrationClient.deleteMany({ where: { id: client.id } });
    }
  }
});


test("PostgreSQL serializes webhook replay requests, rate-limits them, and preserves immutable event sequence", { skip: !enabled }, async () => {
  const tag = suffix();
  const now = new Date();
  let country;
  let state;
  let zone;
  let client;
  let booking;
  let endpoint;
  let event;
  let secretVersion;
  let delivery;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Webhook Replay Country ${tag}` } });
    state = await prisma.state.create({ data: { countryId: country.id, code: `S${tag}`, name: `Webhook Replay State ${tag}` } });
    zone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `Z${tag}`, name: `Webhook Replay Zone ${tag}` } });
    client = await prisma.integrationClient.create({
      data: { code: `webhook-replay-${tag.toLowerCase()}`, name: `Webhook Replay Client ${tag}`, scopes: ["webhooks:manage", "webhooks:read"] },
    });
    booking = await prisma.parcelBooking.create({
      data: {
        publicReference: `WEBHOOK-REPLAY-${tag}`,
        integrationClientId: client.id,
        pickupServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        pickupAddress: "Webhook replay pickup",
        pickupLatitude: 6.5,
        pickupLongitude: 3.4,
        destinationAddress: "Webhook replay destination",
        destinationLatitude: 6.6,
        destinationLongitude: 3.5,
        recipientName: "Webhook Replay Recipient",
        recipientPhone: "+2348000000000",
        parcelCategory: null,
        parcelSize: null,
        connectionFeeMinor: 0n,
        pricingSnapshot: { source: "webhook-replay-integrity-test" },
      },
    });
    endpoint = await prisma.integrationWebhookEndpoint.create({
      data: {
        clientId: client.id,
        url: `https://hooks-${tag.toLowerCase()}.example.org/events`,
        eventTypes: ["shipment.created"],
      },
    });
    secretVersion = await prisma.integrationWebhookSecretVersion.create({
      data: {
        endpointId: endpoint.id,
        version: 1,
        encryptedValue: "dGVzdA==",
        iv: "MDEyMzQ1Njc4OWFi",
        authTag: "MDEyMzQ1Njc4OWFiY2RlZg==",
      },
    });
    event = await prisma.integrationShipmentEvent.create({
      data: {
        clientId: client.id,
        parcelBookingId: booking.id,
        sourceBookingEventId: `source-event-${tag}`,
        sequence: 1,
        eventType: "shipment.created",
        schemaVersion: 1,
        occurredAt: now,
        payload: { shipmentReference: booking.publicReference, status: "AWAITING_PARTNER_ASSIGNMENT" },
      },
    });
    delivery = await prisma.integrationWebhookDelivery.create({
      data: {
        eventId: event.id,
        endpointId: endpoint.id,
        secretVersion: secretVersion.version,
        status: "DEAD",
        attempts: 8,
        totalAttempts: 8,
        lastHttpStatus: 500,
        lastErrorCode: "WEBHOOK_HTTP_500",
      },
    });

    await prisma.integrationWebhookAuditEvent.createMany({
      data: Array.from({ length: 9 }, (_, index) => ({
        clientId: client.id,
        endpointId: endpoint.id,
        action: "WEBHOOK_DELIVERY_REPLAY_REQUESTED",
        metadata: { seed: index },
        createdAt: now,
      })),
    });

    const service = createIntegrationWebhookOperationsService({ prismaClient: prisma, clock: () => now });
    const requests = await Promise.allSettled([
      service.replayDeliveries({ clientId: client.id, credentialId: null, endpointId: endpoint.id, eventId: event.id }),
      service.replayDeliveries({ clientId: client.id, credentialId: null, endpointId: endpoint.id, eventId: event.id }),
    ]);

    assert.equal(requests.filter(result => result.status === "fulfilled").length, 1);
    const rejected = requests.filter(result => result.status === "rejected");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.statusCode, 429);

    const [persistedDelivery, persistedEvent, replayAudits] = await Promise.all([
      prisma.integrationWebhookDelivery.findUnique({ where: { id: delivery.id } }),
      prisma.integrationShipmentEvent.findUnique({ where: { id: event.id } }),
      prisma.integrationWebhookAuditEvent.count({
        where: { endpointId: endpoint.id, action: "WEBHOOK_DELIVERY_REPLAY_REQUESTED" },
      }),
    ]);
    assert.equal(persistedDelivery.status, "PENDING");
    assert.equal(persistedDelivery.attempts, 0);
    assert.equal(persistedDelivery.totalAttempts, 8);
    assert.equal(persistedDelivery.replayCount, 1);
    assert.equal(persistedEvent.sequence, 1);
    assert.equal(replayAudits, 10);
  } finally {
    if (delivery) await prisma.integrationWebhookDelivery.deleteMany({ where: { id: delivery.id } });
    if (event) await prisma.integrationShipmentEvent.deleteMany({ where: { id: event.id } });
    if (endpoint) {
      await prisma.integrationWebhookAuditEvent.deleteMany({ where: { endpointId: endpoint.id } });
      if (secretVersion) await prisma.integrationWebhookSecretVersion.deleteMany({ where: { id: secretVersion.id } });
      await prisma.integrationWebhookEndpoint.deleteMany({ where: { id: endpoint.id } });
    }
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (client) await prisma.integrationClient.deleteMany({ where: { id: client.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

test("PostgreSQL protects execution snapshot idempotency, version uniqueness, and immutability under concurrent writes", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let sender;
  let booking;
  let leg;

  const snapshotData = ({ idempotencyKey, payloadHash, version }) => ({
    deliveryLegId: leg.id,
    version,
    idempotencyKey,
    payloadHash,
    executorType: "PLATFORM_DRIVER",
    selectedDriverProfileId: `driver-${tag}`,
    selectedVehicleId: `vehicle-${tag}`,
    executionCostMinor: 25000n,
    currency: "NGN",
    costSource: "PLATFORM_DRIVER_PAYOUT_RULE",
    costSourceVersion: 1,
    assessmentSnapshot: { readiness: "READY", dispatchAuthorized: false },
    routeSnapshot: { version: 1, legs: [] },
    packageSnapshot: [{ id: `package-${tag}`, weightGrams: 500 }],
    selectedByUserId: sender.id,
    selectedAt: new Date(),
  });

  try {
    country = await prisma.country.create({
      data: { code: `T${tag}`, name: `Execution Snapshot Country ${tag}` },
    });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Execution Snapshot State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Execution Snapshot Zone ${tag}` },
    });
    sender = await prisma.user.create({ data: { fullName: `Execution Snapshot Actor ${tag}` } });
    booking = await prisma.parcelBooking.create({
      data: {
        publicReference: `EXEC-SNAPSHOT-${tag}`,
        senderId: sender.id,
        pickupServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        pickupAddress: "Execution snapshot test pickup",
        pickupLatitude: 6.5,
        pickupLongitude: 3.4,
        destinationAddress: "Execution snapshot test destination",
        destinationLatitude: 6.6,
        destinationLongitude: 3.5,
        recipientName: "Execution Snapshot Recipient",
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
        type: "LOCAL_PICKUP",
        status: "READY_FOR_ASSIGNMENT",
        originServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
      },
    });

    const concurrentWrites = await Promise.allSettled([
      prisma.deliveryLegExecutionSnapshot.create({
        data: snapshotData({
          idempotencyKey: `EXEC-SNAPSHOT-KEY-A-${tag}`,
          payloadHash: "payload-a",
          version: 1,
        }),
      }),
      prisma.deliveryLegExecutionSnapshot.create({
        data: snapshotData({
          idempotencyKey: `EXEC-SNAPSHOT-KEY-B-${tag}`,
          payloadHash: "payload-b",
          version: 1,
        }),
      }),
    ]);
    assert.equal(concurrentWrites.filter(result => result.status === "fulfilled").length, 1);
    const versionConflict = concurrentWrites.find(result => result.status === "rejected");
    assert.equal(versionConflict?.reason?.code, "P2002");
    assert.equal(await prisma.deliveryLegExecutionSnapshot.count({ where: { deliveryLegId: leg.id } }), 1);

    const secondVersion = await prisma.deliveryLegExecutionSnapshot.create({
      data: snapshotData({
        idempotencyKey: `EXEC-SNAPSHOT-KEY-V2-${tag}`,
        payloadHash: "payload-v2",
        version: 2,
      }),
    });
    assert.equal(secondVersion.version, 2);

    await assert.rejects(
      prisma.deliveryLegExecutionSnapshot.update({
        where: { id: secondVersion.id },
        data: { executionCostMinor: 26000n },
      }),
    );
    await assert.rejects(
      prisma.deliveryLegExecutionSnapshot.delete({ where: { id: secondVersion.id } }),
    );
    assert.equal(await prisma.deliveryLegExecutionSnapshot.count({ where: { deliveryLegId: leg.id } }), 2);
    assert.equal(
      (await prisma.deliveryLegExecutionSnapshot.findUnique({ where: { id: secondVersion.id } })).executionCostMinor,
      25000n,
    );
  } finally {
    if (leg) {
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('ALTER TABLE "delivery_leg_execution_snapshots" DISABLE TRIGGER "delivery_leg_execution_snapshots_immutable"');
        await tx.deliveryLegExecutionSnapshot.deleteMany({ where: { deliveryLegId: leg.id } });
        await tx.$executeRawUnsafe('ALTER TABLE "delivery_leg_execution_snapshots" ENABLE TRIGGER "delivery_leg_execution_snapshots_immutable"');
      });
    }
    if (leg) await prisma.deliveryLeg.deleteMany({ where: { id: leg.id } });
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (sender) await prisma.user.deleteMany({ where: { id: sender.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

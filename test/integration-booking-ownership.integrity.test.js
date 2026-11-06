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

test("PostgreSQL enforces exactly one parcel-booking owner and persists all integration packages", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let sender;
  let client;
  const bookingIds = [];

  const bookingData = {
    publicReference: `GIL04B-${tag}`,
    pickupServiceZoneId: null,
    destinationServiceZoneId: null,
    pickupAddress: "Integration pickup",
    pickupLatitude: 6.5,
    pickupLongitude: 3.4,
    destinationAddress: "Integration destination",
    destinationLatitude: 7.4,
    destinationLongitude: 3.9,
    recipientName: "Recipient",
    recipientPhone: "+2348000000000",
    parcelCategory: "box",
    parcelSize: "MEDIUM",
    connectionFeeMinor: 0n,
    pricingSnapshot: {},
  };

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Test Country ${tag}` } });
    state = await prisma.state.create({ data: { countryId: country.id, code: `S${tag}`, name: `Test State ${tag}` } });
    zone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `Z${tag}`, name: `Test Zone ${tag}` } });
    sender = await prisma.user.create({ data: { fullName: `Test Sender ${tag}` } });
    client = await prisma.integrationClient.create({ data: { code: `GIL04B_${tag}`, name: `GIL04B Test Client ${tag}` } });

    const userOwned = await prisma.parcelBooking.create({
      data: { ...bookingData, publicReference: `GIL04B-USER-${tag}`, senderId: sender.id,
        pickupServiceZoneId: zone.id, destinationServiceZoneId: zone.id },
    });
    bookingIds.push(userOwned.id);

    const integrationOwned = await prisma.parcelBooking.create({
      data: { ...bookingData, publicReference: `GIL04B-INTEGRATION-${tag}`, integrationClientId: client.id,
        pickupServiceZoneId: zone.id, destinationServiceZoneId: zone.id },
    });
    bookingIds.push(integrationOwned.id);

    await assert.rejects(
      prisma.parcelBooking.create({
        data: { ...bookingData, publicReference: `GIL04B-NONE-${tag}`,
          pickupServiceZoneId: zone.id, destinationServiceZoneId: zone.id },
      }),
      "A booking without an owner must be rejected by PostgreSQL",
    );

    await assert.rejects(
      prisma.parcelBooking.create({
        data: { ...bookingData, publicReference: `GIL04B-BOTH-${tag}`, senderId: sender.id,
          integrationClientId: client.id, pickupServiceZoneId: zone.id, destinationServiceZoneId: zone.id },
      }),
      "A booking with two owners must be rejected by PostgreSQL",
    );

    await prisma.parcelBookingPackage.createMany({
      data: [
        {
          parcelBookingId: integrationOwned.id, sequence: 1, externalPackageRef: "parcel-001",
          packageCategory: "box", weightGrams: 1200, lengthMm: 300, widthMm: 200, heightMm: 150,
          declaredValueMinor: 125000n, assessmentStatus: "DECLARED",
          assessmentSource: "INTEGRATOR_DECLARED",
          assessmentSnapshot: { source: "integration-quote" },
          rateSnapshot: { rateId: "rate-001", transportChargeMinor: "2500" },
        },
        {
          parcelBookingId: integrationOwned.id, sequence: 2, externalPackageRef: null,
          packageCategory: "carton", weightGrams: 2400, assessmentStatus: "DECLARED",
          assessmentSource: "INTEGRATOR_DECLARED",
        },
      ],
    });

    const packages = await prisma.parcelBookingPackage.findMany({
      where: { parcelBookingId: integrationOwned.id },
      orderBy: { sequence: "asc" },
    });
    assert.equal(packages.length, 2);
    assert.deepEqual(packages.map(item => item.sequence), [1, 2]);
    assert.equal(packages[0].externalPackageRef, "parcel-001");
    assert.equal(packages[0].declaredValueMinor, 125000n);
    assert.equal(packages[0].rateSnapshot.transportChargeMinor, "2500");
    assert.equal(packages[1].externalPackageRef, null);
    assert.equal((await prisma.parcelBooking.findUnique({ where: { id: userOwned.id } })).senderId, sender.id);
    assert.equal((await prisma.parcelBooking.findUnique({ where: { id: integrationOwned.id } })).integrationClientId, client.id);
  } finally {
    if (bookingIds.length) {
      await prisma.parcelBookingPackage.deleteMany({ where: { parcelBookingId: { in: bookingIds } } });
      await prisma.parcelBooking.deleteMany({ where: { id: { in: bookingIds } } });
    }
    if (client) await prisma.integrationClient.deleteMany({ where: { id: client.id } });
    if (sender) await prisma.user.deleteMany({ where: { id: sender.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

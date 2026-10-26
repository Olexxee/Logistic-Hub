import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const enabled = process.env.RUN_POSTGRES_INTEGRITY_TESTS === "true";
const prisma = new PrismaClient();

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

test("PostgreSQL integrity tests are explicitly gated outside the disposable CI database", { skip: enabled }, () => {
  assert.equal(enabled, false);
});

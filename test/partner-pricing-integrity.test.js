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

test("PostgreSQL enforces partner-rate bands and immutable quote totals", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let sender;
  let booking;
  let partner;
  let agreement;
  let rateCard;
  let rate;

  try {
    country = await prisma.country.create({
      data: { code: `T${tag}`, name: `Test Country ${tag}` },
    });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Test State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Test Zone ${tag}` },
    });
    sender = await prisma.user.create({ data: { fullName: `Test Sender ${tag}` } });
    booking = await prisma.parcelBooking.create({
      data: {
        publicReference: `QUOTE-BOOKING-${tag}`,
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
        parcelCategory: "BOX",
        parcelSize: "MEDIUM",
        connectionFeeMinor: 0n,
        pricingSnapshot: {},
      },
    });
    partner = await prisma.transportPartner.create({
      data: { displayName: `Test Partner ${tag}`, status: "ACTIVE", verificationStatus: "VERIFIED" },
    });
    agreement = await prisma.partnerAgreement.create({
      data: {
        partnerId: partner.id,
        reference: `AGREEMENT-${tag}`,
        status: "ACTIVE",
        effectiveFrom: new Date(Date.now() - 60_000),
        approvedAt: new Date(),
      },
    });
    rateCard = await prisma.partnerRateCard.create({
      data: {
        agreementId: agreement.id,
        version: 1,
        status: "ACTIVE",
        effectiveFrom: new Date(Date.now() - 60_000),
        publishedAt: new Date(),
      },
    });

    await assert.rejects(
      prisma.partnerRate.create({
        data: {
          rateCardId: rateCard.id,
          originServiceZoneId: zone.id,
          destinationServiceZoneId: zone.id,
          parcelCategory: "BOX",
          minWeightGrams: 1500,
          maxWeightGrams: 1000,
          transportChargeMinor: 1200n,
        },
      }),
    );

    rate = await prisma.partnerRate.create({
      data: {
        rateCardId: rateCard.id,
        originServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        parcelCategory: "BOX",
        minWeightGrams: 0,
        maxWeightGrams: 5000,
        transportChargeMinor: 1200n,
      },
    });

    const acceptedQuoteData = {
      parcelBookingId: booking.id,
      status: "ACCEPTED",
      partnerAgreementId: agreement.id,
      partnerRateId: rate.id,
      transportChargeMinor: 1200n,
      collectionChargeMinor: 200n,
      hubHandlingChargeMinor: 100n,
      destinationDeliveryChargeMinor: 300n,
      platformChargeMinor: 100n,
      otherChargesMinor: 0n,
      totalCustomerChargeMinor: 1900n,
      chargeBreakdown: { transport: 1200, collection: 200, hubHandling: 100, destinationDelivery: 300, platform: 100, other: 0 },
      inputSnapshot: { originServiceZoneId: zone.id, destinationServiceZoneId: zone.id, parcelCategory: "BOX" },
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: new Date(),
      acceptedByUserId: sender.id,
    };

    const acceptedQuote = await prisma.shipmentQuote.create({ data: { ...acceptedQuoteData, version: 1 } });

    await prisma.parcelBooking.update({
      where: { id: booking.id },
      data: {
        status: "AWAITING_PAYMENT",
        customerPayableMinor: 1900n,
        connectionFeeMinor: 100n,
        otherChargesMinor: 600n,
        pricingSnapshot: {
          quoteId: acceptedQuote.id,
          totalCustomerChargeMinor: "1900",
          currency: "NGN",
        },
      },
    });
    await assert.rejects(
      prisma.parcelBooking.update({
        where: { id: booking.id },
        data: { customerPayableMinor: 2000n },
      }),
    );

    await assert.rejects(
      prisma.shipmentQuote.create({ data: { ...acceptedQuoteData, version: 2 } }),
    );

    await assert.rejects(
      prisma.shipmentQuote.create({
        data: {
          ...acceptedQuoteData,
          version: 3,
          status: "OFFERED",
          acceptedAt: null,
          acceptedByUserId: null,
          totalCustomerChargeMinor: 9999n,
        },
      }),
    );
  } finally {
    if (booking) await prisma.shipmentQuote.deleteMany({ where: { parcelBookingId: booking.id } });
    if (rateCard) await prisma.partnerRate.deleteMany({ where: { rateCardId: rateCard.id } });
    if (rateCard) await prisma.partnerRateCard.deleteMany({ where: { id: rateCard.id } });
    if (agreement) await prisma.partnerAgreement.deleteMany({ where: { id: agreement.id } });
    if (partner) await prisma.transportPartner.deleteMany({ where: { id: partner.id } });
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (sender) await prisma.user.deleteMany({ where: { id: sender.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

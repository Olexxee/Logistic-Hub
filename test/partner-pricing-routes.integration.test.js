import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { createPartnerPricingRouter } from "../src/modules/partner-pricing/partner-pricing.routes.js";

const enabled = process.env.RUN_POSTGRES_INTEGRITY_TESTS === "true";
const prisma = new PrismaClient();

test.after(async () => prisma.$disconnect());

function suffix() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}

test("quote create, list, reject, and accept endpoints enforce the sender lifecycle", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let sender;
  let adminUser;
  let booking;
  let server;
  let activeUserId;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Test Country ${tag}` } });
    state = await prisma.state.create({ data: { countryId: country.id, code: `S${tag}`, name: `Test State ${tag}` } });
    zone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `Z${tag}`, name: `Test Zone ${tag}`, isActive: true } });
    sender = await prisma.user.create({ data: { fullName: `Quote Sender ${tag}` } });
    adminUser = await prisma.user.create({ data: { fullName: `Quote Admin ${tag}`, role: "ADMIN", status: "ACTIVE" } });
    booking = await prisma.parcelBooking.create({
      data: {
        publicReference: `QUOTE-ROUTE-${tag}`,
        senderId: sender.id,
        pickupServiceZoneId: zone.id,
        destinationServiceZoneId: zone.id,
        pickupAddress: "Integration test pickup",
        pickupLatitude: 6.5,
        pickupLongitude: 3.4,
        destinationAddress: "Integration test destination",
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

    const app = express();
    app.use(express.json());
    app.use("/api/v1", createPartnerPricingRouter({
      prismaClient: prisma,
      authMiddleware: (req, _res, next) => {
        req.user = { id: activeUserId, role: activeUserId === adminUser.id ? "ADMIN" : "CUSTOMER" };
        next();
      },
      adminMiddleware: (_req, _res, next) => next(),
    }));
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (path, { method = "GET", body } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, json: await response.json() };
    };

    activeUserId = adminUser.id;
    const created = await call(`/admin/parcel-bookings/${booking.id}/quotes`, {
      method: "POST",
      body: { transportChargeMinor: "1200", reason: "Approved manual test quote", expiresInMinutes: 60 },
    });
    assert.equal(created.status, 201);
    const rejectedQuoteId = created.json.data.quote.id;

    activeUserId = sender.id;
    const listed = await call(`/parcel-bookings/${booking.id}/quotes`);
    assert.equal(listed.status, 200);
    assert.equal(listed.json.data.items.length, 1);

    const rejected = await call(`/parcel-bookings/${booking.id}/quotes/${rejectedQuoteId}/reject`, {
      method: "POST",
      body: { reason: "Customer declines this price" },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json.data.replay, false);
    const rejectedReplay = await call(`/parcel-bookings/${booking.id}/quotes/${rejectedQuoteId}/reject`, {
      method: "POST",
      body: { reason: "Retry after network timeout" },
    });
    assert.equal(rejectedReplay.status, 200);
    assert.equal(rejectedReplay.json.data.replay, true);

    activeUserId = adminUser.id;
    const [second, third] = await Promise.all([
      call(`/admin/parcel-bookings/${booking.id}/quotes`, {
        method: "POST",
        body: { transportChargeMinor: "1500", reason: "Concurrent approved quote A", expiresInMinutes: 60 },
      }),
      call(`/admin/parcel-bookings/${booking.id}/quotes`, {
        method: "POST",
        body: { transportChargeMinor: "1500", reason: "Concurrent approved quote B", expiresInMinutes: 60 },
      }),
    ]);
    assert.equal(second.status, 201);
    assert.equal(third.status, 201);
    const concurrentQuotes = [second.json.data.quote, third.json.data.quote];
    assert.deepEqual(concurrentQuotes.map((quote) => quote.version).sort((a, b) => a - b), [2, 3]);
    const latestQuote = concurrentQuotes.find((quote) => quote.version === 3);

    activeUserId = sender.id;
    await prisma.parcelBooking.update({ where: { id: booking.id }, data: { status: "MATCHING" } });
    const blockedMatchingAcceptance = await call(`/parcel-bookings/${booking.id}/quotes/${latestQuote.id}/accept`, { method: "POST" });
    assert.equal(blockedMatchingAcceptance.status, 409);
    const stillOfferedDuringMatching = await prisma.shipmentQuote.findUnique({ where: { id: second.json.data.quote.id } });
    assert.equal(stillOfferedDuringMatching.status, "OFFERED");

    await prisma.parcelBooking.update({ where: { id: booking.id }, data: { status: "IN_TRANSIT" } });
    const blockedLateAcceptance = await call(`/parcel-bookings/${booking.id}/quotes/${latestQuote.id}/accept`, { method: "POST" });
    assert.equal(blockedLateAcceptance.status, 409);
    assert.equal(blockedLateAcceptance.json.error.code, "QUOTE_NOT_ACCEPTABLE");
    const stillOffered = await prisma.shipmentQuote.findUnique({ where: { id: second.json.data.quote.id } });
    assert.equal(stillOffered.status, "OFFERED");

    await prisma.parcelBooking.update({ where: { id: booking.id }, data: { status: "DRAFT" } });
    const accepted = await call(`/parcel-bookings/${booking.id}/quotes/${latestQuote.id}/accept`, { method: "POST" });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.data.quote.status, "ACCEPTED");
    assert.equal(accepted.json.data.replay, false);
    const acceptedReplay = await call(`/parcel-bookings/${booking.id}/quotes/${latestQuote.id}/accept`, { method: "POST" });
    assert.equal(acceptedReplay.status, 200);
    assert.equal(acceptedReplay.json.data.quote.status, "ACCEPTED");
    assert.equal(acceptedReplay.json.data.replay, true);

    const persistedBooking = await prisma.parcelBooking.findUnique({ where: { id: booking.id } });
    assert.equal(persistedBooking.status, "AWAITING_PAYMENT");
    assert.equal(persistedBooking.driverFareMinor, null);
    assert.equal(persistedBooking.customerPayableMinor, 1500n);
    const persistedEvent = await prisma.bookingEvent.findFirst({
      where: { parcelBookingId: booking.id, eventType: "SHIPMENT_QUOTE_REJECTED" },
    });
    assert.equal(persistedEvent.metadata.reason, "Customer declines this price");
    const acceptedEvent = await prisma.bookingEvent.findFirst({
      where: { parcelBookingId: booking.id, eventType: "SHIPMENT_QUOTE_ACCEPTED" },
    });
    assert.ok(acceptedEvent);
    assert.equal(acceptedEvent.actorUserId, sender.id);
    assert.equal(acceptedEvent.fromStatus, "DRAFT");
    assert.equal(acceptedEvent.toStatus, "AWAITING_PAYMENT");
    assert.equal(acceptedEvent.metadata.quoteId, second.json.data.quote.id);
    assert.equal(acceptedEvent.metadata.totalCustomerChargeMinor, "1500");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (booking) {
      await prisma.bookingEvent.deleteMany({ where: { parcelBookingId: booking.id } });
      await prisma.shipmentQuote.deleteMany({ where: { parcelBookingId: booking.id } });
    }
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (sender) await prisma.user.deleteMany({ where: { id: sender.id } });
    if (adminUser) await prisma.user.deleteMany({ where: { id: adminUser.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

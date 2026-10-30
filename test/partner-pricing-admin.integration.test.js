import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { createPartnerPricingRouter } from "../src/modules/partner-pricing/partner-pricing.routes.js";

const enabled = process.env.RUN_POSTGRES_INTEGRITY_TESTS === "true";
const prisma = new PrismaClient();

test.after(async () => prisma.$disconnect());

function suffix() {
  return randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}

test("partner, agreement, and rate-card administration enforces publish prerequisites", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let destinationZone;
  let partner;
  let adminUser;
  let agreement;
  let rateCard;
  let server;

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Admin Test Country ${tag}` } });
    state = await prisma.state.create({ data: { countryId: country.id, code: `S${tag}`, name: `Admin Test State ${tag}` } });
    zone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `Z${tag}`, name: `Admin Test Zone ${tag}`, isActive: true } });
    destinationZone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `D${tag}`, name: `Admin Test Destination Zone ${tag}`, isActive: true } });

    adminUser = await prisma.user.create({ data: { fullName: `Partner Admin ${tag}`, role: "ADMIN", status: "ACTIVE" } });

    const app = express();
    app.use(express.json());
    app.use("/api/v1", createPartnerPricingRouter({
      prismaClient: prisma,
      authMiddleware: (req, _res, next) => {
        req.user = { id: adminUser.id, role: "ADMIN" };
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

    const createdPartner = await call("/admin/transport-partners", {
      method: "POST",
      body: { displayName: `Integration Partner ${tag}`, contactEmail: `partner-${tag.toLowerCase()}@example.test` },
    });
    assert.equal(createdPartner.status, 201);
    partner = createdPartner.json.data.partner;
    assert.equal(partner.status, "PENDING");

    const blockedActivation = await call(`/admin/transport-partners/${partner.id}/status`, {
      method: "PATCH",
      body: { status: "ACTIVE" },
    });
    assert.equal(blockedActivation.status, 409);
    assert.equal(blockedActivation.json.error.code, "PARTNER_NOT_VERIFIED");

    const verifiedPartner = await call(`/admin/transport-partners/${partner.id}/status`, {
      method: "PATCH",
      body: { status: "ACTIVE", verificationStatus: "VERIFIED" },
    });
    assert.equal(verifiedPartner.status, 200);
    assert.equal(verifiedPartner.json.data.partner.status, "ACTIVE");
    assert.equal(verifiedPartner.json.data.partner.verificationStatus, "VERIFIED");

    const agreementResult = await call(`/admin/transport-partners/${partner.id}/agreements`, {
      method: "POST",
      body: {
        reference: `TEST-AGREEMENT-${tag}`,
        currency: "NGN",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    assert.equal(agreementResult.status, 201);
    agreement = agreementResult.json.data.agreement;
    assert.equal(agreement.status, "DRAFT");

    const activatedAgreement = await call(`/admin/partner-agreements/${agreement.id}/activate`, { method: "POST" });
    assert.equal(activatedAgreement.status, 200);
    assert.equal(activatedAgreement.json.data.agreement.status, "ACTIVE");

    const cardResult = await call(`/admin/partner-agreements/${agreement.id}/rate-cards`, {
      method: "POST",
      body: { currency: "NGN", effectiveFrom: new Date(Date.now() - 60_000).toISOString() },
    });
    assert.equal(cardResult.status, 201);
    rateCard = cardResult.json.data.rateCard;
    assert.equal(rateCard.status, "DRAFT");

    const blockedPublish = await call(`/admin/partner-rate-cards/${rateCard.id}/publish`, { method: "POST" });
    assert.equal(blockedPublish.status, 409);
    assert.equal(blockedPublish.json.error.code, "RATE_CARD_HAS_NO_ACTIVE_RATES");

    const rateResult = await call(`/admin/partner-rate-cards/${rateCard.id}/rates`, {
      method: "POST",
      body: {
        originServiceZoneId: zone.id,
        destinationServiceZoneId: destinationZone.id,
        serviceType: "PARCEL_DELIVERY",
        parcelCategory: "BOX",
        minWeightGrams: 0,
        maxWeightGrams: 5000,
        transportChargeMinor: "250000",
        estimatedTransitMinutes: 90,
      },
    });
    assert.equal(rateResult.status, 201);
    assert.equal(rateResult.json.data.rate.transportChargeMinor, "250000");

    const published = await call(`/admin/partner-rate-cards/${rateCard.id}/publish`, { method: "POST" });
    assert.equal(published.status, 200);
    assert.equal(published.json.data.rateCard.status, "ACTIVE");

    const persisted = await prisma.partnerRateCard.findUnique({
      where: { id: rateCard.id },
      include: { rates: true, agreement: { include: { partner: true } } },
    });
    assert.equal(persisted.status, "ACTIVE");
    assert.equal(persisted.rates.length, 1);
    assert.equal(persisted.rates[0].transportChargeMinor, 250000n);
    assert.equal(persisted.agreement.status, "ACTIVE");
    assert.equal(persisted.agreement.partner.verificationStatus, "VERIFIED");

    const listed = await call("/admin/transport-partners");
    assert.equal(listed.status, 200);
    assert.ok(listed.json.data.items.some((item) => item.id === partner.id && item._count.agreements === 1));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (rateCard) await prisma.partnerRate.deleteMany({ where: { rateCardId: rateCard.id } });
    if (rateCard) await prisma.partnerRateCard.deleteMany({ where: { id: rateCard.id } });
    if (agreement) await prisma.partnerAgreement.deleteMany({ where: { id: agreement.id } });
    if (partner) await prisma.transportPartner.deleteMany({ where: { id: partner.id } });
    if (adminUser) await prisma.user.deleteMany({ where: { id: adminUser.id } });
    if (destinationZone) await prisma.serviceZone.deleteMany({ where: { id: destinationZone.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

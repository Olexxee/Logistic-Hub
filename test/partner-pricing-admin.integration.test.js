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
  let ownerUser;
  let ownerMembership;
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
      body: { status: "ACTIVE", reason: "Initial activation review." },
    });
    assert.equal(blockedActivation.status, 409);
    assert.equal(blockedActivation.json.error.code, "PARTNER_NOT_VERIFIED");

    ownerUser = await prisma.user.create({
      data: { fullName: `Partner Owner ${tag}`, role: "PARTNER_OPERATOR", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    ownerMembership = await prisma.transportPartnerMember.create({
      data: { partnerId: partner.id, userId: ownerUser.id, role: "OWNER", isActive: true },
    });

    const verifiedPartner = await call(`/admin/transport-partners/${partner.id}/status`, {
      method: "PATCH",
      body: { status: "ACTIVE", verificationStatus: "VERIFIED", reason: "Verification and owner checks passed." },
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

    const activatedAgreement = await call(`/admin/partner-agreements/${agreement.id}/activate`, { method: "POST", body: { reason: "Agreement terms reviewed and approved." } });
    assert.equal(activatedAgreement.status, 200);
    assert.equal(activatedAgreement.json.data.agreement.status, "ACTIVE");

    const agreementList = await call(`/admin/transport-partners/${partner.id}/agreements?status=ACTIVE&page=1&limit=10`);
    assert.equal(agreementList.status, 200);
    assert.ok(agreementList.json.data.items.some(item => item.id === agreement.id));
    assert.equal(agreementList.json.data.pagination.total, 1);

    const agreementDetail = await call(`/admin/partner-agreements/${agreement.id}`);
    assert.equal(agreementDetail.status, 200);
    assert.equal(agreementDetail.json.data.agreement.partner.id, partner.id);
    assert.equal(agreementDetail.json.data.agreement.rateCards.length, 0);

    const cardResult = await call(`/admin/partner-agreements/${agreement.id}/rate-cards`, {
      method: "POST",
      body: { currency: "NGN", effectiveFrom: new Date(Date.now() - 60_000).toISOString() },
    });
    assert.equal(cardResult.status, 201);
    rateCard = cardResult.json.data.rateCard;
    assert.equal(rateCard.status, "DRAFT");

    const blockedPublish = await call(`/admin/partner-rate-cards/${rateCard.id}/publish`, { method: "POST", body: { reason: "Rate card reviewed against negotiated partner terms." } });
    assert.equal(blockedPublish.status, 409);
    assert.equal(blockedPublish.json.error.code, "RATE_CARD_HAS_NO_ACTIVE_RATES");

    const cardList = await call(`/admin/partner-agreements/${agreement.id}/rate-cards?status=DRAFT&page=1&limit=10`);
    assert.equal(cardList.status, 200);
    assert.ok(cardList.json.data.items.some(item => item.id === rateCard.id));

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

    const published = await call(`/admin/partner-rate-cards/${rateCard.id}/publish`, { method: "POST", body: { reason: "Published after checking negotiated partner rates." } });
    assert.equal(published.status, 200);
    assert.equal(published.json.data.rateCard.status, "ACTIVE");

    const cardDetail = await call(`/admin/partner-rate-cards/${rateCard.id}`);
    assert.equal(cardDetail.status, 200);
    assert.equal(cardDetail.json.data.rateCard.rates.length, 1);
    assert.equal(cardDetail.json.data.rateCard.rates[0].transportChargeMinor, "250000");
    assert.equal(cardDetail.json.data.rateCard.rates[0].originServiceZone.id, zone.id);

    const persisted = await prisma.partnerRateCard.findUnique({
      where: { id: rateCard.id },
      include: { rates: true, agreement: { include: { partner: true } } },
    });
    assert.equal(persisted.status, "ACTIVE");
    assert.equal(persisted.rates.length, 1);
    assert.equal(persisted.rates[0].transportChargeMinor, 250000n);
    assert.equal(persisted.agreement.status, "ACTIVE");
    assert.equal(persisted.agreement.partner.verificationStatus, "VERIFIED");

    const detail = await call(`/admin/transport-partners/${partner.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.partner.id, partner.id);
    assert.equal(detail.json.data.partner._count.agreements, 1);

    const updatedProfile = await call(`/admin/transport-partners/${partner.id}`, {
      method: "PATCH",
      body: { contactName: "Updated Contact", reason: "Corrected partner contact record." },
    });
    assert.equal(updatedProfile.status, 200);
    assert.equal(updatedProfile.json.data.partner.contactName, "Updated Contact");
    const profileAudit = await prisma.operationalAuditEvent.findFirst({
      where: { entityType: "TRANSPORT_PARTNER", entityId: partner.id, action: "PARTNER_PROFILE_UPDATED" },
    });
    assert.equal(profileAudit.reason, "Corrected partner contact record.");
    assert.equal(profileAudit.before.contactName, null);
    assert.equal(profileAudit.after.contactName, "Updated Contact");

    const statusAudit = await prisma.operationalAuditEvent.findFirst({
      where: { entityType: "TRANSPORT_PARTNER", entityId: partner.id, action: "PARTNER_STATUS_UPDATED" },
    });
    assert.equal(statusAudit.reason, "Verification and owner checks passed.");

    const listed = await call("/admin/transport-partners?status=ACTIVE&verificationStatus=VERIFIED&search=Integration%20Partner&page=1&limit=10");
    assert.equal(listed.status, 200);
    assert.ok(listed.json.data.items.some((item) => item.id === partner.id && item._count.agreements === 1));
    assert.ok(listed.json.data.pagination.total >= 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (rateCard) await prisma.operationalAuditEvent.deleteMany({ where: { entityId: rateCard.id } });
    if (agreement) await prisma.operationalAuditEvent.deleteMany({ where: { entityId: agreement.id } });
    if (partner) await prisma.operationalAuditEvent.deleteMany({ where: { entityId: partner.id } });
    if (ownerMembership) await prisma.transportPartnerMember.deleteMany({ where: { id: ownerMembership.id } });
    if (ownerUser) await prisma.user.deleteMany({ where: { id: ownerUser.id } });
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

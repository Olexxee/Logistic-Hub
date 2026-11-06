import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationQuoteService } from "../src/modules/integrations/integration-quote.service.js";

function mockPrisma({ billingModel = "PLATFORM_COLLECTED" } = {}) {
  const state = { idempotency: [], sessions: [], packages: [], options: [], externalRefs: [] };
  const agreement = {
    id: "billing_1", reference: "marketplace-default", version: 1, status: "ACTIVE",
    currency: "NGN", billingModel, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: null,
  };
  const rateCard = {
    id: "card_1", version: 3, agreementId: "partner_agreement_1", status: "ACTIVE", currency: "NGN",
    agreement: { id: "partner_agreement_1", partner: { id: "partner_1", displayName: "Contracted carrier" } },
  };
  const rates = [
    { id: "rate_box", rateCardId: "card_1", parcelCategory: "box", minWeightGrams: 0, maxWeightGrams: 10000,
      maxLengthMm: null, maxWidthMm: null, maxHeightMm: null, transportChargeMinor: 2500n, estimatedTransitMinutes: 180, rateCard },
    { id: "rate_carton", rateCardId: "card_1", parcelCategory: "carton", minWeightGrams: 0, maxWeightGrams: 20000,
      maxLengthMm: null, maxWidthMm: null, maxHeightMm: null, transportChargeMinor: 4000n, estimatedTransitMinutes: 240, rateCard },
  ];
  const alternateRateCard = {
    id: "card_2", version: 2, agreementId: "partner_agreement_2", status: "ACTIVE", currency: "NGN",
    agreement: { id: "partner_agreement_2", partner: { id: "partner_2", displayName: "Alternate carrier" } },
  };
  rates.push(
    { id: "rate_box_alt", rateCardId: "card_2", parcelCategory: "box", minWeightGrams: 0, maxWeightGrams: 10000,
      maxLengthMm: null, maxWidthMm: null, maxHeightMm: null, transportChargeMinor: 3000n, estimatedTransitMinutes: 150, rateCard: alternateRateCard },
    { id: "rate_carton_alt", rateCardId: "card_2", parcelCategory: "carton", minWeightGrams: 0, maxWeightGrams: 20000,
      maxLengthMm: null, maxWidthMm: null, maxHeightMm: null, transportChargeMinor: 4500n, estimatedTransitMinutes: 200, rateCard: alternateRateCard },
  );
  const tx = {
    integrationIdempotencyRecord: {
      findUnique: async ({ where }) => state.idempotency.find(r => r.clientId === where.clientId_operation_idempotencyKey.clientId
        && r.operation === where.clientId_operation_idempotencyKey.operation
        && r.idempotencyKey === where.clientId_operation_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }) => { state.idempotency.push(data); return data; },
    },
    integrationBillingAgreement: { findFirst: async () => agreement },
    serviceZone: { findMany: async ({ where }) => [
      { id: "zone_a", code: "A", name: "Zone A", stateId: "state_a" },
      { id: "zone_b", code: "B", name: "Zone B", stateId: "state_b" },
    ].filter(z => where.id.in.includes(z.id)) },
    pricingRule: { findMany: async () => [{ id: "pricing_1", serviceZoneId: "zone_a", currency: "NGN", fixedConnectionFeeMinor: 500n }] },
    partnerRate: { findMany: async () => rates },
    integrationQuoteSession: {
      create: async ({ data }) => {
        const session = { id: `quote_${state.sessions.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        session.packages = data.packages.create.map((p, i) => ({ id: `pkg_${i + 1}`, createdAt: new Date(), ...p }));
        state.sessions.push(session);
        state.packages.push(...session.packages);
        return session;
      },
      findFirst: async ({ where }) => state.sessions.find(s => s.id === where.id && s.clientId === where.clientId) ?? null,
      updateMany: async ({ where, data }) => {
        const s = state.sessions.find(s => s.id === where.id && s.clientId === where.clientId && s.status === where.status);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      },
      findUnique: async ({ where }) => state.sessions.find(s => s.clientId === where.clientId_externalReference.clientId
        && s.externalReference === where.clientId_externalReference.externalReference) ?? null,
    },
    integrationQuoteOption: {
      create: async ({ data }) => {
        const option = { id: `option_${state.options.length + 1}`, status: "AVAILABLE", createdAt: new Date(), updatedAt: new Date(), ...data };
        state.options.push(option);
        return option;
      },
      findFirst: async ({ where }) => state.options.find(o => o.id === where.id && o.quoteSessionId === where.quoteSessionId
        && o.status === where.status && o.expiresAt > where.expiresAt.gt) ?? null,
      update: async ({ where, data }) => {
        const o = state.options.find(o => o.id === where.id);
        Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }) => {
        const items = state.options.filter(o => o.quoteSessionId === where.quoteSessionId
          && o.id !== where.id.not && o.status === where.status);
        items.forEach(o => Object.assign(o, data));
        return { count: items.length };
      },
    },
    integrationExternalReference: { create: async ({ data }) => { state.externalRefs.push(data); return data; } },
  };
  const prismaClient = { ...tx, $transaction: work => work(tx) };
  return { prismaClient, state };
}

const client = { id: "client_1", code: "market_iq", scopes: ["quotes:write", "quotes:read"] };
const baseInput = {
  billingAgreementReference: "marketplace-default", externalReference: "order-1001",
  pickupServiceZoneId: "zone_a", destinationServiceZoneId: "zone_b",
  pickupAddress: "Warehouse address", pickup: { latitude: 6.5, longitude: 3.3 },
  destinationAddress: "Recipient address", destination: { latitude: 7.4, longitude: 3.9 },
  recipientName: "Recipient", recipientPhone: "08012345678",
  packages: [
    { externalPackageRef: "carton-1", packageCategory: "box", weightGrams: 1000 },
    { externalPackageRef: "carton-2", packageCategory: "carton", weightGrams: 2000 },
  ],
  expiresInMinutes: 60,
};

test("quote session prices every package against one contracted rate card", async () => {
  const { prismaClient, state } = mockPrisma();
  const service = createIntegrationQuoteService({ prismaClient });
  const result = await service.createQuote({ client, idempotencyKey: "quote-create-001", input: baseInput });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.quoteSession.status, "QUOTED");
  assert.equal(result.body.options.length, 2);
  assert.equal(result.body.options[0].logisticsCostMinor, "6500");
  assert.equal(result.body.options[0].platformChargeMinor, "500");
  assert.equal(result.body.options[0].customerChargeMinor, "7000");
  assert.equal(state.packages.length, 2);
  assert.equal(state.options[0].packageRateSnapshot.length, 2);
});

test("missing declared weight creates a measurement-required session without price options", async () => {
  const { prismaClient, state } = mockPrisma();
  const service = createIntegrationQuoteService({ prismaClient });
  const input = { ...baseInput, externalReference: "order-1002", packages: [{ packageCategory: "box" }] };
  const result = await service.createQuote({ client, idempotencyKey: "quote-create-002", input });
  assert.equal(result.body.quoteSession.status, "REQUIRES_MEASUREMENT");
  assert.equal(result.body.options.length, 0);
  assert.equal(state.options.length, 0);
  assert.equal(state.packages[0].assessmentStatus, "REQUIRES_MEASUREMENT");
});

test("same idempotency key and payload replays the original quote response", async () => {
  const { prismaClient, state } = mockPrisma();
  const service = createIntegrationQuoteService({ prismaClient });
  const first = await service.createQuote({ client, idempotencyKey: "quote-create-003", input: baseInput });
  const second = await service.createQuote({ client, idempotencyKey: "quote-create-003", input: baseInput });
  assert.equal(second.replay, true);
  assert.deepEqual(JSON.parse(JSON.stringify(second.body)), JSON.parse(JSON.stringify(first.body)));
  assert.equal(state.sessions.length, 1);
});

test("same idempotency key with a different payload is rejected", async () => {
  const { prismaClient } = mockPrisma();
  const service = createIntegrationQuoteService({ prismaClient });
  await service.createQuote({ client, idempotencyKey: "quote-create-004", input: baseInput });
  await assert.rejects(
    service.createQuote({ client, idempotencyKey: "quote-create-004", input: { ...baseInput, recipientName: "Changed" } }),
    error => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("acceptance selects one option and rejects the remaining alternatives", async () => {
  const { prismaClient, state } = mockPrisma();
  const service = createIntegrationQuoteService({ prismaClient });
  const quote = await service.createQuote({ client, idempotencyKey: "quote-create-005", input: baseInput });
  const option = state.options[0];
  const accepted = await service.acceptOption({
    client, quoteSessionId: quote.body.quoteSession.id, optionId: option.id, idempotencyKey: "quote-accept-005",
  });
  assert.equal(accepted.body.status, "SELECTED");
  assert.equal(state.sessions[0].status, "SELECTED");
  assert.equal(state.options[0].status, "SELECTED");
  assert.equal(state.options[1].status, "REJECTED");
});

test("quote creation refuses billing models whose financial workflows are not implemented", async () => {
  const { prismaClient } = mockPrisma({ billingModel: "PREPAID_ACCOUNT" });
  const service = createIntegrationQuoteService({ prismaClient });
  await assert.rejects(
    service.createQuote({ client, idempotencyKey: "quote-create-006", input: baseInput }),
    error => error.code === "INTEGRATION_BILLING_MODEL_UNSUPPORTED",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationShipmentService } from "../src/modules/integrations/integration-shipment.service.js";

const now = new Date("2026-11-07T09:00:00.000Z");

function fixture({ amountMinor = "3000", sessionStatus = "SELECTED", optionStatus = "SELECTED" } = {}) {
  const state = {
    idempotency: null,
    booking: null,
    quote: null,
    packages: [],
    legs: [],
    attestation: null,
    externalReferences: [],
    bookingEvents: [],
    sessionStatus,
    userCreates: 0,
    paymentAttemptCreates: 0,
  };
  const pkg = {
    id: "quote_package_1",
    packageSequence: 0,
    externalPackageRef: "pkg-1",
    packageCategory: "carton",
    description: "Books",
    weightGrams: 1200,
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    declaredValueMinor: 50000n,
    assessmentStatus: "DECLARED",
    assessmentSource: "INTEGRATOR_DECLARED",
    assessmentConfidence: null,
    assessedAt: new Date("2026-11-07T07:30:00.000Z"),
    createdAt: new Date("2026-11-07T07:30:00.000Z"),
  };
  const rate = {
    id: "rate_1",
    rateCardId: "rate_card_1",
    parcelCategory: "carton",
    minWeightGrams: 0,
    maxWeightGrams: 10000,
    maxLengthMm: null,
    maxWidthMm: null,
    maxHeightMm: null,
    transportChargeMinor: 2500n,
    isActive: true,
  };
  const billingAgreement = {
    id: "billing_1",
    clientId: "client_1",
    reference: "marketplace-default",
    version: 2,
    status: "ACTIVE",
    billingModel: "PLATFORM_COLLECTED",
    currency: "NGN",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
  };
  const partnerAgreement = {
    id: "partner_agreement_1",
    status: "ACTIVE",
    currency: "NGN",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    partner: { id: "partner_1", status: "ACTIVE", verificationStatus: "VERIFIED" },
  };
  const option = {
    id: "option_1",
    status: optionStatus,
    partnerAgreementId: partnerAgreement.id,
    partnerRateCardId: "rate_card_1",
    currency: "NGN",
    logisticsCostMinor: 2500n,
    platformChargeMinor: 500n,
    otherChargesMinor: 0n,
    customerChargeMinor: 3000n,
    routeMode: "END_TO_END",
    routeSnapshot: { routeMode: "END_TO_END" },
    packageRateSnapshot: [{
      packageRef: "pkg-1",
      externalPackageRef: "pkg-1",
      rateId: rate.id,
      transportChargeMinor: "2500",
    }],
    expiresAt: new Date("2026-11-07T10:00:00.000Z"),
  };
  const session = {
    id: "quote_session_1",
    clientId: "client_1",
    billingAgreementId: billingAgreement.id,
    billingAgreementVersion: 2,
    externalReference: "MARKETIQ-ORDER-100",
    status: sessionStatus,
    selectedOptionId: option.id,
    currency: "NGN",
    pickupServiceZoneId: "zone_lagos",
    destinationServiceZoneId: "zone_ogun",
    pickupAddress: "Pickup address",
    pickupLatitude: 6.5,
    pickupLongitude: 3.4,
    destinationAddress: "Destination address",
    destinationLatitude: 6.8,
    destinationLongitude: 3.5,
    recipientName: "Recipient",
    recipientPhone: "+2348000000000",
    createdAt: new Date("2026-11-07T07:00:00.000Z"),
    expiresAt: new Date("2026-11-07T10:00:00.000Z"),
    billingAgreement,
    packages: [pkg],
    options: [option],
  };
  const tx = {
    integrationIdempotencyRecord: {
      findUnique: async () => state.idempotency,
      create: async ({ data }) => { state.idempotency = data; return data; },
    },
    integrationExternalReference: {
      findFirst: async () => null,
      create: async ({ data }) => { state.externalReferences.push(data); return data; },
    },
    integrationQuoteSession: {
      findFirst: async () => ({ ...session, status: state.sessionStatus }),
      updateMany: async ({ data }) => { state.sessionStatus = data.status; return { count: 1 }; },
    },
    integrationBillingAgreement: { findFirst: async () => billingAgreement },
    partnerRateCard: { findFirst: async () => ({ id: "rate_card_1", agreementId: partnerAgreement.id, agreement: partnerAgreement }) },
    partnerRate: { findMany: async () => [rate] },
    serviceZone: {
      findMany: async () => [
        { id: "zone_lagos", code: "LAG", name: "Lagos", stateId: "NG-LA" },
        { id: "zone_ogun", code: "OGN", name: "Ogun", stateId: "NG-OG" },
      ],
    },
    parcelBooking: {
      create: async ({ data }) => {
        state.booking = { id: "booking_1", ...data };
        state.packages = data.parcelPackages.create.map((item, index) => ({ id: `booking_package_${index + 1}`, ...item }));
        state.booking.parcelPackages = state.packages;
        return state.booking;
      },
      updateMany: async () => ({ count: 1 }),
    },
    shipmentQuote: {
      create: async ({ data }) => { state.quote = { id: "shipment_quote_1", ...data }; return state.quote; },
    },
    deliveryLeg: {
      create: async ({ data }) => {
        const leg = { id: `delivery_leg_${state.legs.length + 1}`, ...data };
        state.legs.push(leg);
        return {
          id: leg.id, sequence: leg.sequence, type: leg.type, status: leg.status,
          originServiceZoneId: leg.originServiceZoneId, destinationServiceZoneId: leg.destinationServiceZoneId,
          originHubPointId: leg.originHubPointId, destinationHubPointId: leg.destinationHubPointId,
        };
      },
    },
    integrationPaymentAttestation: {
      create: async ({ data }) => { state.attestation = data; return data; },
    },
    bookingEvent: {
      create: async ({ data }) => { state.bookingEvents.push(data); return data; },
    },
    hubPoint: { findMany: async () => [] },
    user: { create: async () => { state.userCreates += 1; } },
    paymentAttempt: { create: async () => { state.paymentAttemptCreates += 1; } },
  };
  const prismaClient = {
    $transaction: async work => work(tx),
    integrationIdempotencyRecord: {
      findUnique: async () => state.idempotency,
    },
    integrationPaymentAttestation: {
      findFirst: async () => null,
    },
    integrationExternalReference: {
      findFirst: async () => null,
    },
  };
  const input = {
    quoteSessionId: session.id,
    quoteOptionId: option.id,
    externalFulfillmentReference: session.externalReference,
    paymentAttestation: {
      paymentProvider: "paystack",
      externalPaymentReference: "PAYSTACK-REF-100",
      verifiedAt: "2026-11-07T08:30:00.000Z",
      currency: "NGN",
      deliveryChargeMinor: amountMinor,
      orderPaymentAmountMinor: "125000",
    },
  };
  return { state, session, option, prismaClient, input };
}

test("integration shipment atomically creates an integration-owned booking, accepted quote, packages and route plan", async () => {
  const { state, prismaClient, input } = fixture();
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.createShipment({
    client: { id: "client_1" },
    idempotencyKey: "shipment-create-100",
    input,
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.shipment.status, "AWAITING_PARTNER_ASSIGNMENT");
  assert.equal(result.body.shipment.paymentStatus, "SUCCEEDED");
  assert.equal(state.booking.senderId, null);
  assert.equal(state.booking.integrationClientId, "client_1");
  assert.equal(state.booking.parcelCategory, null);
  assert.equal(state.booking.parcelSize, null);
  assert.equal(state.booking.declaredValueMinor, null);
  assert.equal(state.packages.length, 1);
  assert.equal(state.packages[0].packageCategory, "carton");
  assert.equal(state.quote.status, "ACCEPTED");
  assert.equal(state.quote.acceptedByUserId, null);
  assert.equal(state.quote.partnerAgreementId, "partner_agreement_1");
  assert.equal(state.quote.transportChargeMinor, 2500n);
  assert.equal(state.legs.length, 1);
  assert.equal(state.legs[0].type, "INTERSTATE_TRANSPORT");
  assert.equal(state.legs[0].status, "READY_FOR_ASSIGNMENT");
  assert.equal(state.attestation.deliveryChargeMinor, 3000n);
  assert.equal(state.attestation.paymentProvider, "PAYSTACK");
  assert.equal(state.sessionStatus, "BOOKED");
  assert.equal(state.externalReferences[0].resourceType, "SHIPMENT");
  assert.equal(state.bookingEvents[0].eventType, "INTEGRATION_SHIPMENT_CREATED");
  assert.equal(state.userCreates, 0);
  assert.equal(state.paymentAttemptCreates, 0);
});

test("integration shipment creation replays the original response for an identical idempotent request", async () => {
  const { state, prismaClient, input } = fixture();
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const first = await service.createShipment({ client: { id: "client_1" }, idempotencyKey: "shipment-create-100", input });
  const second = await service.createShipment({ client: { id: "client_1" }, idempotencyKey: "shipment-create-100", input });

  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.deepEqual(second.body, state.idempotency.responseBody);
  assert.equal(state.legs.length, 1);
});

test("integration shipment rejects an external payment attestation with a mismatched delivery amount before creating records", async () => {
  const { state, prismaClient, input } = fixture({ amountMinor: "2999" });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });

  await assert.rejects(
    service.createShipment({ client: { id: "client_1" }, idempotencyKey: "shipment-create-101", input }),
    error => error.code === "INTEGRATION_PAYMENT_AMOUNT_MISMATCH",
  );
  assert.equal(state.booking, null);
  assert.equal(state.quote, null);
  assert.equal(state.attestation, null);
  assert.equal(state.legs.length, 0);
});

test("integration shipment cannot be created from a quote that is not selected", async () => {
  const { state, prismaClient, input } = fixture({ sessionStatus: "QUOTED" });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });

  await assert.rejects(
    service.createShipment({ client: { id: "client_1" }, idempotencyKey: "shipment-create-102", input }),
    error => error.code === "INTEGRATION_QUOTE_NOT_SELECTED",
  );
  assert.equal(state.booking, null);
});

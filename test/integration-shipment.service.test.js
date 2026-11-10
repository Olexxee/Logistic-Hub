import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationShipmentService } from "../src/modules/integrations/integration-shipment.service.js";

const now = new Date("2026-11-07T09:00:00.000Z");

function fixture({
  amountMinor = "3000",
  sessionStatus = "SELECTED",
  optionStatus = "SELECTED",
  sessionExpiresAt = new Date("2026-11-07T10:00:00.000Z"),
  optionExpiresAt = new Date("2026-11-07T10:00:00.000Z"),
  billingAgreementStatus = "ACTIVE",
  partnerEligible = true,
  rateActive = true,
  zonesActive = true,
  paymentVerifiedAt = "2026-11-07T08:30:00.000Z",
  externalReference = "MARKETIQ-ORDER-100",
  externalReferenceExists = false,
  duplicatePaymentReference = false,
  sessionUpdateCount = 1,
  serializableFailures = 0,
  failAt = null,
} = {}) {
  const state = {
    idempotency: null,
    booking: null,
    quote: null,
    packages: [],
    legs: [],
    attestation: null,
    externalReferences: [],
    bookingEvents: [],
    integrationEvents: [],
    integrationEventSequence: 0,
    sessionStatus,
    userCreates: 0,
    paymentAttemptCreates: 0,
    transactionAttempts: 0,
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
    isActive: rateActive,
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
    partner: { id: "partner_1", status: partnerEligible ? "ACTIVE" : "SUSPENDED", verificationStatus: partnerEligible ? "VERIFIED" : "PENDING" },
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
    expiresAt: optionExpiresAt,
  };
  const session = {
    id: "quote_session_1",
    clientId: "client_1",
    billingAgreementId: billingAgreement.id,
    billingAgreementVersion: 2,
    externalReference,
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
    expiresAt: sessionExpiresAt,
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
      findFirst: async () => externalReferenceExists ? { id: "existing-reference" } : null,
      create: async ({ data }) => { if (failAt === "externalReference") throw new Error("injected external reference failure"); state.externalReferences.push(data); return data; },
    },
    integrationQuoteSession: {
      findFirst: async () => ({ ...session, status: state.sessionStatus }),
      updateMany: async ({ data }) => { state.sessionStatus = data.status; return { count: sessionUpdateCount }; },
    },
    integrationBillingAgreement: { findFirst: async () => billingAgreementStatus === "ACTIVE" ? billingAgreement : null },
    partnerRateCard: { findFirst: async () => partnerEligible ? ({ id: "rate_card_1", agreementId: partnerAgreement.id, agreement: partnerAgreement }) : null },
    partnerRate: { findMany: async () => rateActive ? [rate] : [] },
    serviceZone: {
      findMany: async () => zonesActive ? [
        { id: "zone_lagos", code: "LAG", name: "Lagos", stateId: "NG-LA" },
        { id: "zone_ogun", code: "OGN", name: "Ogun", stateId: "NG-OG" },
      ] : [],
    },
    parcelBooking: {
      findUnique: async () => state.booking ? {
        id: state.booking.id,
        integrationClientId: state.booking.integrationClientId,
        senderId: state.booking.senderId,
        publicReference: state.booking.publicReference,
        status: state.booking.status,
      } : null,
      update: async () => {
        state.integrationEventSequence += 1;
        return { integrationEventSequence: state.integrationEventSequence };
      },
      create: async ({ data }) => {
        if (failAt === "booking") throw new Error("injected booking failure");
        state.booking = { id: "booking_1", ...data };
        state.packages = data.parcelPackages.create.map((item, index) => ({ id: `booking_package_${index + 1}`, ...item }));
        state.booking.parcelPackages = state.packages;
        return state.booking;
      },
      updateMany: async () => ({ count: 1 }),
    },
    shipmentQuote: {
      create: async ({ data }) => { if (failAt === "quote") throw new Error("injected quote failure"); state.quote = { id: "shipment_quote_1", ...data }; return state.quote; },
    },
    deliveryLeg: {
      create: async ({ data }) => {
        if (failAt === "leg") throw new Error("injected delivery leg failure");
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
      create: async ({ data }) => { if (failAt === "attestation") throw new Error("injected attestation failure"); state.attestation = data; return data; },
    },
    bookingEvent: {
      create: async ({ data }) => {
        if (failAt === "bookingEvent") throw new Error("injected booking event failure");
        state.bookingEvents.push(data);
        return { id: "booking_event_1", createdAt: now, ...data };
      },
    },
    integrationShipmentEvent: {
      findUnique: async () => null,
      create: async ({ data }) => {
        const event = { id: "integration_event_1", ...data };
        state.integrationEvents.push(event);
        return event;
      },
    },
    integrationWebhookEndpoint: { findMany: async () => [] },
    integrationWebhookDelivery: { createMany: async () => ({ count: 0 }) },
    hubPoint: { findMany: async () => [] },
    user: { create: async () => { state.userCreates += 1; } },
    paymentAttempt: { create: async () => { state.paymentAttemptCreates += 1; } },
  };
  const prismaClient = {
    $transaction: async work => {
      state.transactionAttempts += 1;
      if (state.transactionAttempts <= serializableFailures) { const error = new Error("serialization conflict"); error.code = "P2034"; throw error; }
      const snapshot = structuredClone(state);
      try { return await work(tx); }
      catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, snapshot); throw error; }
    },
    integrationIdempotencyRecord: {
      findUnique: async () => state.idempotency,
    },
    integrationPaymentAttestation: {
      findFirst: async () => duplicatePaymentReference ? { id: "duplicate-payment" } : null,
    },
    integrationExternalReference: {
      findFirst: async () => externalReferenceExists ? { id: "duplicate-shipment" } : null,
    },
  };
  const input = {
    quoteSessionId: session.id,
    quoteOptionId: option.id,
    externalFulfillmentReference: session.externalReference,
    paymentAttestation: {
      paymentProvider: "paystack",
      externalPaymentReference: "PAYSTACK-REF-100",
      verifiedAt: paymentVerifiedAt,
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


test("shipment creation rejects an expired quote session and an expired selected option", async t => {
  await t.test("expired session", async () => {
    const { state, prismaClient, input } = fixture({ sessionExpiresAt: new Date("2026-11-07T08:59:59.999Z") });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "expired-session", input }),
      error => error.code === "INTEGRATION_QUOTE_EXPIRED");
    assert.equal(state.booking, null);
  });
  await t.test("expired selected option", async () => {
    const { state, prismaClient, input } = fixture({ optionExpiresAt: new Date("2026-11-07T08:59:59.999Z") });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "expired-option", input }),
      error => error.code === "INTEGRATION_QUOTE_OPTION_UNAVAILABLE");
    assert.equal(state.booking, null);
  });
});

test("shipment creation fails closed when billing or partner commercial eligibility is suspended", async t => {
  await t.test("billing agreement suspended", async () => {
    const { state, prismaClient, input } = fixture({ billingAgreementStatus: "SUSPENDED" });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "billing-suspended", input }),
      error => error.code === "INTEGRATION_BILLING_AGREEMENT_INACTIVE");
    assert.equal(state.booking, null);
  });
  await t.test("partner agreement suspended", async () => {
    const { state, prismaClient, input } = fixture({ partnerEligible: false });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "partner-suspended", input }),
      error => error.code === "INTEGRATION_PARTNER_AGREEMENT_INACTIVE");
    assert.equal(state.booking, null);
  });
  await t.test("partner rate inactive", async () => {
    const { state, prismaClient, input } = fixture({ rateActive: false });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "rate-inactive", input }),
      error => error.code === "INTEGRATION_PARTNER_RATE_INACTIVE");
    assert.equal(state.booking, null);
  });
});

test("shipment creation rejects unavailable zones, mismatched fulfilment references and invalid payment timestamps", async t => {
  await t.test("service zone unavailable", async () => {
    const { state, prismaClient, input } = fixture({ zonesActive: false });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "zone-inactive", input }),
      error => error.code === "SERVICE_ZONE_UNAVAILABLE");
    assert.equal(state.booking, null);
  });
  await t.test("fulfilment reference mismatch", async () => {
    const { state, prismaClient, input } = fixture();
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "reference-mismatch",
      input: { ...input, externalFulfillmentReference: "ANOTHER-ORDER" } }),
      error => error.code === "INTEGRATION_FULFILLMENT_REFERENCE_MISMATCH");
    assert.equal(state.booking, null);
  });
  await t.test("payment verified in the future", async () => {
    const { state, prismaClient, input } = fixture({ paymentVerifiedAt: "2026-11-07T09:00:00.001Z" });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "future-payment", input }),
      error => error.code === "INTEGRATION_PAYMENT_ATTESTATION_INVALID");
    assert.equal(state.booking, null);
  });
  await t.test("payment verified before quote creation", async () => {
    const { state, prismaClient, input } = fixture({ paymentVerifiedAt: "2026-11-07T06:59:59.999Z" });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "early-payment", input }),
      error => error.code === "INTEGRATION_PAYMENT_ATTESTATION_INVALID");
    assert.equal(state.booking, null);
  });
});

test("shipment creation rejects duplicate fulfilment and payment references", async t => {
  await t.test("fulfilment reference already mapped", async () => {
    const { state, prismaClient, input } = fixture({ externalReferenceExists: true });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "duplicate-fulfilment", input }),
      error => error.code === "INTEGRATION_SHIPMENT_ALREADY_CREATED");
    assert.equal(state.booking, null);
  });
  await t.test("payment reference already attested after a uniqueness race", async () => {
    const { state, prismaClient, input } = fixture({ duplicatePaymentReference: true, failAt: "attestation" });
    const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
    const originalCreate = prismaClient.$transaction;
    prismaClient.$transaction = async work => {
      try { return await originalCreate(work); }
      catch (error) { error.code = "P2002"; throw error; }
    };
    await assert.rejects(service.createShipment({ client: { id: "client_1" }, idempotencyKey: "duplicate-payment", input }),
      error => error.code === "INTEGRATION_PAYMENT_REFERENCE_REUSED");
  });
});

test("shipment creation rejects idempotency-key reuse with a different payload", async () => {
  const { state, prismaClient, input } = fixture();
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  await service.createShipment({ client: { id: "client_1" }, idempotencyKey: "same-key", input });
  await assert.rejects(
    service.createShipment({ client: { id: "client_1" }, idempotencyKey: "same-key",
      input: { ...input, paymentAttestation: { ...input.paymentAttestation, orderPaymentAmountMinor: "125001" } } }),
    error => error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(state.legs.length, 1);
});

test("shipment creation retries a PostgreSQL serialization failure without duplicating records", async () => {
  const { state, prismaClient, input } = fixture({ serializableFailures: 1 });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.createShipment({ client: { id: "client_1" }, idempotencyKey: "serialization-retry", input });
  assert.equal(result.statusCode, 201);
  assert.equal(state.transactionAttempts, 2);
  assert.equal(state.legs.length, 1);
  assert.equal(state.bookingEvents.length, 1);
});

test("a late transaction failure rolls back booking, packages, quote, legs, attestation, mapping, events and idempotency", async () => {
  const { state, prismaClient, input } = fixture({ failAt: "bookingEvent" });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.createShipment({ client: { id: "client_1" }, idempotencyKey: "rollback-late-failure", input }),
    /injected booking event failure/,
  );
  assert.equal(state.booking, null);
  assert.equal(state.packages.length, 0);
  assert.equal(state.quote, null);
  assert.equal(state.legs.length, 0);
  assert.equal(state.attestation, null);
  assert.equal(state.externalReferences.length, 0);
  assert.equal(state.bookingEvents.length, 0);
  assert.equal(state.idempotency, null);
  assert.equal(state.sessionStatus, "SELECTED");
});

test("a quote state change during shipment creation aborts the complete transaction", async () => {
  const { state, prismaClient, input } = fixture({ sessionUpdateCount: 0 });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.createShipment({ client: { id: "client_1" }, idempotencyKey: "quote-race", input }),
    error => error.code === "INTEGRATION_QUOTE_NOT_BOOKABLE",
  );
  assert.equal(state.booking, null);
  assert.equal(state.quote, null);
  assert.equal(state.legs.length, 0);
  assert.equal(state.attestation, null);
  assert.equal(state.externalReferences.length, 0);
  assert.equal(state.idempotency, null);
});


test("shipment creation atomically projects a sanitized first tracking event", async () => {
  const { state, prismaClient, input } = fixture();
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.createShipment({
    client: { id: "client_1" },
    idempotencyKey: "shipment-create-001",
    input,
  });

  assert.equal(result.statusCode, 201);
  assert.equal(state.integrationEvents.length, 1);
  assert.equal(state.integrationEvents[0].sequence, 1);
  assert.equal(state.integrationEvents[0].eventType, "shipment.created");
  assert.deepEqual(state.integrationEvents[0].payload, {
    shipmentReference: state.booking.publicReference,
    status: "AWAITING_PARTNER_ASSIGNMENT",
  });
  assert.equal("externalPaymentReference" in state.integrationEvents[0].payload, false);
  assert.equal("recipientPhone" in state.integrationEvents[0].payload, false);
});


function actionFixture({
  bookingStatus = "AWAITING_PARTNER_ASSIGNMENT",
  legStatus = "READY_FOR_ASSIGNMENT",
  assignments = [],
  custodyHandovers = [],
  pendingHandovers = [],
  routeMode = "END_TO_END",
  legType = "INTERSTATE_TRANSPORT",
  packingEvidenceFrozenAt = null,
} = {}) {
  const state = {
    booking: {
      id: "booking-action-1",
      integrationClientId: "client_1",
      senderId: null,
      publicReference: "LH-PCL-ACTION",
      status: bookingStatus,
      paymentStatus: "SUCCEEDED",
      integrationPackingEvidenceFrozenAt: packingEvidenceFrozenAt,
      integrationDispatchAuthorizedAt: null,
      pricingSnapshot: { routeSnapshot: { routeMode } },
      deliveryLegs: [{ id: "leg-action-1", type: legType, status: legStatus }],
      custodyHandovers: [...structuredClone(custodyHandovers), ...structuredClone(pendingHandovers)],
    },
    assignments: structuredClone(assignments),
    pendingHandovers: structuredClone(pendingHandovers),
    bookingEvents: [],
    integrationEvents: [],
    idempotency: [],
    eventSequence: 0,
  };
  const tx = {
    $queryRaw: async () => [],
    integrationIdempotencyRecord: {
      findUnique: async ({ where }) => state.idempotency.find(item =>
        item.clientId === where.clientId_operation_idempotencyKey.clientId
        && item.operation === where.clientId_operation_idempotencyKey.operation
        && item.idempotencyKey === where.clientId_operation_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }) => { state.idempotency.push(data); return data; },
    },
    integrationExternalReference: { findFirst: async () => ({ internalResourceId: state.booking.id }) },
    parcelBooking: {
      findFirst: async () => structuredClone(state.booking),
      findUnique: async () => ({
        id: state.booking.id, integrationClientId: state.booking.integrationClientId,
        senderId: state.booking.senderId, publicReference: state.booking.publicReference,
        status: state.booking.status,
      }),
      updateMany: async ({ where, data }) => {
        if (where.id !== state.booking.id || where.integrationClientId !== state.booking.integrationClientId) return { count: 0 };
        const allowed = where.status?.in ?? [where.status];
        if (!allowed.includes(state.booking.status)) return { count: 0 };
        Object.assign(state.booking, data);
        return { count: 1 };
      },
      update: async ({ data }) => {
        if (data.integrationEventSequence?.increment) state.eventSequence += data.integrationEventSequence.increment;
        return { integrationEventSequence: state.eventSequence };
      },
    },
    partnerDeliveryAssignment: {
      findMany: async () => structuredClone(state.assignments),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const item of state.assignments) {
          if (where.deliveryLegId.in.includes(item.deliveryLegId) && where.status.in.includes(item.status)) {
            Object.assign(item, data); count += 1;
          }
        }
        return { count };
      },
    },
    deliveryLeg: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const leg of state.booking.deliveryLegs) {
          if (where.parcelBookingId === state.booking.id && where.status.in.includes(leg.status)) {
            Object.assign(leg, data); count += 1;
          }
        }
        return { count };
      },
    },
    custodyHandover: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const item of state.pendingHandovers) {
          if (item.parcelBookingId === where.parcelBookingId && item.status === where.status) {
            Object.assign(item, data); count += 1;
          }
        }
        return { count };
      },
    },
    bookingEvent: {
      findFirst: async ({ where }) => state.bookingEvents.find(item =>
        item.parcelBookingId === where.parcelBookingId && item.eventType === where.eventType) ?? null,
      create: async ({ data }) => {
        const event = { id: `booking-event-${state.bookingEvents.length + 1}`, createdAt: now, ...data };
        state.bookingEvents.push(event);
        return event;
      },
    },
    integrationShipmentEvent: {
      findUnique: async () => null,
      create: async ({ data }) => {
        const event = { id: `integration-event-${state.integrationEvents.length + 1}`, sequence: data.sequence, eventType: data.eventType, payload: data.payload };
        state.integrationEvents.push(event);
        return event;
      },
    },
    integrationWebhookEndpoint: { findMany: async () => [] },
    integrationWebhookDelivery: { createMany: async () => ({ count: 0 }) },
  };
  const prismaClient = {
    $transaction: async work => {
      const snapshot = structuredClone(state);
      try { return await work(tx); }
      catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, snapshot); throw error; }
    },
  };
  return { state, prismaClient };
}

test("integration stop atomically cancels an unassigned shipment and projects a terminal event", async () => {
  const { state, prismaClient } = actionFixture();
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.stopShipment({
    client: { id: "client_1" }, idempotencyKey: "stop-shipment-001",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer cancelled before dispatch",
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "STOPPED");
  assert.equal(state.booking.status, "CANCELLED");
  assert.equal(state.booking.deliveryLegs[0].status, "CANCELLED");
  assert.equal(state.booking.cancelledAt.toISOString(), now.toISOString());
  assert.equal(state.bookingEvents[0].eventType, "INTEGRATION_SHIPMENT_STOPPED");
  assert.equal(state.integrationEvents[0].eventType, "shipment.cancelled");
  assert.equal(state.integrationEvents[0].payload.status, "CANCELLED");
});

test("integration stop cancels an accepted assignment and pending custody handover before transfer", async () => {
  const { state, prismaClient } = actionFixture({
    bookingStatus: "DRIVER_ASSIGNED",
    legStatus: "ASSIGNED",
    assignments: [{ id: "assignment-1", deliveryLegId: "leg-action-1", status: "ACCEPTED" }],
    pendingHandovers: [{ id: "handover-1", parcelBookingId: "booking-action-1", status: "PENDING_CONFIRMATION" }],
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.stopShipment({
    client: { id: "client_1" }, idempotencyKey: "stop-shipment-002",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer cancelled before collection",
  });
  assert.equal(result.body.status, "STOPPED");
  assert.equal(state.assignments[0].status, "CANCELLED");
  assert.equal(state.pendingHandovers[0].status, "CANCELLED");
  assert.equal(state.booking.deliveryLegs[0].status, "CANCELLED");
});

test("integration stop refuses to claim success after partner or hub custody has begun", async () => {
  const { state, prismaClient } = actionFixture({
    bookingStatus: "IN_TRANSIT",
    legStatus: "IN_TRANSIT",
    assignments: [{ id: "assignment-1", deliveryLegId: "leg-action-1", status: "IN_TRANSIT" }],
    custodyHandovers: [{ id: "handover-1", fromPartyType: "HUB", toPartyType: "TRANSPORT_PARTNER" }],
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.stopShipment({
      client: { id: "client_1" }, idempotencyKey: "stop-shipment-003",
      externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer changed their mind",
    }),
    error => error.code === "INTEGRATION_SHIPMENT_STOP_WINDOW_CLOSED",
  );
  assert.equal(state.booking.status, "IN_TRANSIT");
  assert.equal(state.bookingEvents.length, 0);
});

test("integration return request records operational action without falsely cancelling or completing the shipment", async () => {
  const { state, prismaClient } = actionFixture({
    bookingStatus: "IN_TRANSIT",
    legStatus: "IN_TRANSIT",
    assignments: [{ id: "assignment-1", deliveryLegId: "leg-action-1", status: "IN_TRANSIT" }],
    custodyHandovers: [{ id: "handover-1", status: "CONFIRMED", fromPartyType: "HUB", toPartyType: "TRANSPORT_PARTNER", fromPartyId: "hub-1", toPartyId: "partner-1", confirmedAt: now }],
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.requestShipmentReturn({
    client: { id: "client_1" }, idempotencyKey: "return-shipment-001",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer requests return to seller",
  });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.status, "RETURN_REQUESTED");
  assert.equal(result.body.physicalReturnConfirmed, false);
  assert.equal(state.booking.status, "IN_TRANSIT");
  assert.equal(state.bookingEvents[0].eventType, "INTEGRATION_RETURN_REQUESTED");
  assert.equal(state.integrationEvents[0].eventType, "shipment.return_requested");
  assert.equal(state.integrationEvents[0].payload.status, "IN_TRANSIT");
});

test("a return request is not duplicated when a client retries with a different idempotency key", async () => {
  const { state, prismaClient } = actionFixture({
    bookingStatus: "IN_TRANSIT",
    legStatus: "IN_TRANSIT",
    assignments: [{ id: "assignment-1", deliveryLegId: "leg-action-1", status: "IN_TRANSIT" }],
    custodyHandovers: [{ id: "handover-1", status: "CONFIRMED", fromPartyType: "HUB", toPartyType: "TRANSPORT_PARTNER", fromPartyId: "hub-1", toPartyId: "partner-1", confirmedAt: now }],
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  await service.requestShipmentReturn({
    client: { id: "client_1" }, idempotencyKey: "return-shipment-002",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer requests return to seller",
  });
  const second = await service.requestShipmentReturn({
    client: { id: "client_1" }, idempotencyKey: "return-shipment-003",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer repeats return request",
  });
  assert.equal(second.statusCode, 202);
  assert.equal(second.body.alreadyRequested, true);
  assert.equal(second.body.physicalReturnConfirmed, false);
  assert.equal(state.bookingEvents.length, 1);
  assert.equal(state.integrationEvents.length, 1);
});


test("integration stop replays an identical command and rejects idempotency-key payload reuse", async () => {
  const { state, prismaClient } = actionFixture();
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const input = {
    client: { id: "client_1" }, idempotencyKey: "stop-shipment-replay",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer cancelled before dispatch",
  };
  const first = await service.stopShipment(input);
  const replay = await service.stopShipment(input);
  assert.equal(first.body.status, "STOPPED");
  assert.equal(replay.replay, true);
  assert.equal(state.bookingEvents.length, 1);
  await assert.rejects(
    service.stopShipment({ ...input, reason: "Different cancellation reason" }),
    error => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("an in-transit partner assignment is sufficient evidence for a return request", async () => {
  const { state, prismaClient } = actionFixture({
    bookingStatus: "DRIVER_ASSIGNED",
    legStatus: "IN_TRANSIT",
    assignments: [{ id: "assignment-1", deliveryLegId: "leg-action-1", status: "IN_TRANSIT" }],
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.requestShipmentReturn({
    client: { id: "client_1" }, idempotencyKey: "return-shipment-assignment-only",
    externalFulfillmentReference: "MARKETIQ-ORDER-100", reason: "Buyer requests return to seller",
  });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.status, "RETURN_REQUESTED");
  assert.equal(state.booking.status, "DRIVER_ASSIGNED");
});


test("integration dispatch authorization accepts a paid local-direct shipment only after packing evidence is frozen", async () => {
  const { state, prismaClient } = actionFixture({
    routeMode: "LOCAL_DIRECT",
    legType: "LOCAL_PICKUP",
    packingEvidenceFrozenAt: now,
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  const result = await service.authorizeDispatch({
    client: { id: "client_1" },
    idempotencyKey: "authorize-local-direct-001",
    externalFulfillmentReference: "MARKETIQ-ORDER-100",
    reason: "Packing review completed",
  });
  assert.equal(result.statusCode, 200);
  assert.equal(state.booking.integrationDispatchAuthorizedAt.toISOString(), now.toISOString());
  assert.equal(state.bookingEvents[0].eventType, "INTEGRATION_DISPATCH_AUTHORIZED");
  assert.equal(state.bookingEvents[0].metadata.routeMode, "LOCAL_DIRECT");
});

test("integration dispatch authorization blocks local-direct shipments until packing evidence is frozen", async () => {
  const { state, prismaClient } = actionFixture({
    routeMode: "LOCAL_DIRECT",
    legType: "LOCAL_PICKUP",
  });
  const service = createIntegrationShipmentService({ prismaClient, clock: () => now });
  await assert.rejects(
    service.authorizeDispatch({
      client: { id: "client_1" },
      idempotencyKey: "authorize-local-direct-unfrozen",
      externalFulfillmentReference: "MARKETIQ-ORDER-100",
      reason: "Attempt before packing review",
    }),
    error => error.code === "INTEGRATION_PACKING_EVIDENCE_NOT_FROZEN",
  );
  assert.equal(state.booking.integrationDispatchAuthorizedAt, null);
  assert.equal(state.bookingEvents.length, 0);
});

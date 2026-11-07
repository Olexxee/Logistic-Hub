import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationShipmentService } from "../src/modules/integrations/integration-shipment-read.service.js";

function bookingFixture() {
  return {
    id: "booking-1",
    publicReference: "LH-PCL-ABC123",
    integrationClientId: "client-a",
    senderId: null,
    status: "IN_TRANSIT",
    paymentStatus: "SUCCEEDED",
    currency: "NGN",
    customerPayableMinor: 3000n,
    pricingSnapshot: { routeSnapshot: { routeMode: "END_TO_END" } },
    createdAt: new Date("2026-11-07T08:00:00.000Z"),
    updatedAt: new Date("2026-11-07T09:00:00.000Z"),
    parcelPackages: [{
      packageSequence: 0,
      externalPackageRef: "pkg-1",
      packageCategory: "carton",
      description: "Books",
      weightGrams: 1200,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      assessmentStatus: "DECLARED",
      assessmentSource: "INTEGRATOR_DECLARED",
      assessedAt: new Date("2026-11-07T07:00:00.000Z"),
    }],
    deliveryLegs: [{
      id: "leg-1",
      sequence: 1,
      type: "INTERSTATE_TRANSPORT",
      status: "IN_TRANSIT",
      originServiceZone: { id: "zone-a", code: "LAG", name: "Lagos" },
      destinationServiceZone: { id: "zone-b", code: "OGN", name: "Ogun" },
      plannedAt: new Date("2026-11-07T08:00:00.000Z"),
      assignedAt: new Date("2026-11-07T08:15:00.000Z"),
      pickedUpAt: null,
      startedAt: new Date("2026-11-07T09:00:00.000Z"),
      completedAt: null,
      failureReason: null,
    }],
    quotes: [{
      version: 1,
      status: "ACCEPTED",
      currency: "NGN",
      totalCustomerChargeMinor: 3000n,
      acceptedAt: new Date("2026-11-07T07:30:00.000Z"),
    }],
    integrationPaymentAttestation: {
      paymentProvider: "PAYSTACK",
      verifiedAt: new Date("2026-11-07T07:20:00.000Z"),
      attestedAt: new Date("2026-11-07T07:25:00.000Z"),
      deliveryChargeMinor: 3000n,
      currency: "NGN",
    },
  };
}

function fixture({ booking = bookingFixture(), mapping = {
  externalReference: "ORDER-100",
  internalResourceId: "booking-1",
}, clientId = "client-a" } = {}) {
  const calls = { booking: [], mapping: [] };
  const prismaClient = {
    parcelBooking: {
      findFirst: async args => {
        calls.booking.push(args);
        return booking;
      },
    },
    integrationExternalReference: {
      findFirst: async args => {
        calls.mapping.push(args);
        if (args.where.internalResourceId) {
          return mapping && mapping.internalResourceId === args.where.internalResourceId
            ? { externalReference: mapping.externalReference } : null;
        }
        return mapping;
      },
    },
  };
  return { service: createIntegrationShipmentService({ prismaClient }), calls, clientId };
}

test("shipment read by ID is scoped to the authenticated integration client and omits partner costs and declared values", async () => {
  const { service, calls } = fixture();
  const result = await service.getShipment({ clientId: "client-a", shipmentId: "booking-1" });

  assert.deepEqual(calls.booking[0].where, {
    id: "booking-1",
    integrationClientId: "client-a",
    senderId: null,
  });
  assert.equal(result.externalFulfillmentReference, "ORDER-100");
  assert.equal(result.status, "IN_TRANSIT");
  assert.equal(result.customerChargeMinor, "3000");
  assert.equal(result.deliveryLegs[0].status, "IN_TRANSIT");
  assert.equal(result.packages[0].sequence, 0);
  assert.equal(result.paymentAttestation.status, "ATTESTED");
  assert.equal("declaredValueMinor" in result.packages[0], false);
  assert.equal("transportChargeMinor" in result, false);
  assert.equal("logisticsCostMinor" in result, false);
});

test("shipment recovery by external reference scopes the mapping and booking to the same client", async () => {
  const { service, calls } = fixture();
  const result = await service.getShipmentByExternalReference({
    clientId: "client-a",
    externalFulfillmentReference: "ORDER-100",
  });

  assert.deepEqual(calls.mapping[0].where, {
    clientId: "client-a",
    resourceType: "SHIPMENT",
    externalReference: "ORDER-100",
    internalResourceType: "ParcelBooking",
  });
  assert.equal(calls.booking[0].where.integrationClientId, "client-a");
  assert.equal(result.id, "booking-1");
});

test("an external reference owned by another client is indistinguishable from an unknown reference", async () => {
  const { service, calls } = fixture({ mapping: null });
  await assert.rejects(
    service.getShipmentByExternalReference({
      clientId: "client-b",
      externalFulfillmentReference: "ORDER-100",
    }),
    error => error.code === "INTEGRATION_SHIPMENT_NOT_FOUND",
  );
  assert.equal(calls.booking.length, 0);
  assert.equal(calls.mapping[0].where.clientId, "client-b");
});

test("a shipment ID belonging to another client returns not found", async () => {
  const { service, calls } = fixture({ booking: null });
  await assert.rejects(
    service.getShipment({ clientId: "client-b", shipmentId: "booking-1" }),
    error => error.code === "INTEGRATION_SHIPMENT_NOT_FOUND",
  );
  assert.equal(calls.booking[0].where.integrationClientId, "client-b");
});

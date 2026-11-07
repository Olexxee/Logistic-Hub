import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationShipmentEventsService } from "../src/modules/integrations/integration-shipment-events.service.js";
import { projectIntegrationShipmentEvent } from "../src/modules/integrations/integration-shipment-events.projector.js";

test("tracking history is scoped to an integration-owned shipment and uses an ascending cursor", async () => {
  const calls = [];
  const prismaClient = {
    parcelBooking: {
      findFirst: async args => {
        calls.push({ model: "booking", args });
        return { id: "shipment-a" };
      },
    },
    integrationShipmentEvent: {
      findMany: async args => {
        calls.push({ model: "events", args });
        return [
          { id: "event-2", sequence: 2, eventType: "shipment.in_transit", schemaVersion: 1, occurredAt: new Date(), payload: { status: "IN_TRANSIT" } },
          { id: "event-3", sequence: 3, eventType: "shipment.delivery_leg_completed", schemaVersion: 1, occurredAt: new Date(), payload: { status: "IN_TRANSIT" } },
          { id: "event-4", sequence: 4, eventType: "shipment.delivery_leg_completed", schemaVersion: 1, occurredAt: new Date(), payload: { status: "IN_TRANSIT" } },
        ];
      },
    },
  };
  const service = createIntegrationShipmentEventsService({ prismaClient });
  const result = await service.listEvents({ clientId: "client-a", shipmentId: "shipment-a", afterSequence: 1, limit: 2 });

  assert.deepEqual(calls[0].args.where, { id: "shipment-a", integrationClientId: "client-a", senderId: null });
  assert.deepEqual(calls[1].args.where, { clientId: "client-a", parcelBookingId: "shipment-a", sequence: { gt: 1 } });
  assert.deepEqual(calls[1].args.orderBy, { sequence: "asc" });
  assert.equal(calls[1].args.take, 3);
  assert.deepEqual(result.events.map(event => event.sequence), [2, 3]);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextAfterSequence, 3);
});

test("tracking history returns the same not-found result for unknown and cross-client shipments", async () => {
  const service = createIntegrationShipmentEventsService({
    prismaClient: { parcelBooking: { findFirst: async () => null }, integrationShipmentEvent: { findMany: async () => [] } },
  });
  await assert.rejects(
    service.listEvents({ clientId: "client-b", shipmentId: "shipment-a" }),
    error => error.code === "INTEGRATION_SHIPMENT_NOT_FOUND",
  );
});

test("event projector assigns a monotonic sequence and persists only sanitized payload fields", async () => {
  const state = { sequence: 0, created: [] };
  const tx = {
    integrationShipmentEvent: {
      findUnique: async () => null,
      create: async ({ data }) => { const event = { id: "event-1", ...data }; state.created.push(event); return event; },
    },
    parcelBooking: {
      findUnique: async () => ({
        id: "shipment-a", integrationClientId: "client-a", senderId: null,
        publicReference: "LH-PCL-ABC", status: "DRIVER_ASSIGNED",
      }),
      update: async () => ({ integrationEventSequence: ++state.sequence }),
    },
  };
  const event = await projectIntegrationShipmentEvent({
    tx,
    parcelBookingId: "shipment-a",
    sourceEvent: {
      id: "booking-event-1",
      eventType: "INTEGRATION_PARTNER_ASSIGNMENT_CREATED",
      toStatus: "DRIVER_ASSIGNED",
      createdAt: new Date("2026-11-07T10:00:00.000Z"),
      metadata: { recipientPhone: "+2348000000000", externalPaymentReference: "secret-payment-ref" },
    },
  });

  assert.equal(event.sequence, 1);
  assert.equal(event.eventType, "shipment.partner_assigned");
  assert.deepEqual(state.created[0].payload, { shipmentReference: "LH-PCL-ABC", status: "DRIVER_ASSIGNED" });
  assert.equal("metadata" in state.created[0], false);
});

test("event projector ignores unsupported internal audit events and customer-owned bookings", async () => {
  let updates = 0;
  const tx = {
    integrationShipmentEvent: { findUnique: async () => null, create: async () => { throw new Error("must not create"); } },
    parcelBooking: {
      findUnique: async () => ({ id: "shipment-a", integrationClientId: null, senderId: "customer-a" }),
      update: async () => { updates += 1; },
    },
  };
  const unsupported = await projectIntegrationShipmentEvent({
    tx, parcelBookingId: "shipment-a",
    sourceEvent: { id: "event-internal", eventType: "INTERNAL_ONLY" },
  });
  assert.equal(unsupported, null);
  const customerOwned = await projectIntegrationShipmentEvent({
    tx, parcelBookingId: "shipment-a",
    sourceEvent: { id: "event-customer", eventType: "INTEGRATION_SHIPMENT_CREATED" },
  });
  assert.equal(customerOwned, null);
  assert.equal(updates, 0);
});

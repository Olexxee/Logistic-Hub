import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationWebhookOperationsService } from "../src/modules/integrations/integration-webhook-operations.service.js";

const now = new Date("2026-11-07T18:00:00.000Z");

function fixture({ endpointStatus = "ACTIVE", clientStatus = "ACTIVE", auditCount = 0, deliveries = [] } = {}) {
  const state = {
    endpointStatus,
    clientStatus,
    audit: [],
    deliveries: deliveries.map(row => ({ ...row })),
    lastDeliveryQuery: null,
    lastDeliveryUpdate: null,
  };
  const tx = {
    $queryRaw: async () => [{ id: "endpoint-1" }],
    integrationWebhookEndpoint: {
      findFirst: async ({ where }) => where.id === "endpoint-1" && where.clientId === "client-1"
        ? { id: "endpoint-1", status: state.endpointStatus, eventTypes: ["shipment.created", "shipment.in_transit"] }
        : null,
    },
    integrationClient: {
      findUnique: async () => ({ status: state.clientStatus }),
    },
    integrationWebhookAuditEvent: {
      count: async () => auditCount + state.audit.length,
      create: async ({ data }) => { state.audit.push(data); return data; },
    },
    integrationWebhookDelivery: {
      findMany: async args => {
        state.lastDeliveryQuery = args;
        return state.deliveries.filter(row => {
          const where = args.where;
          if (where.endpointId && row.endpointId !== where.endpointId) return false;
          if (where.status?.in && !where.status.in.includes(row.status)) return false;
          if (where.event?.id && row.event.id !== where.event.id) return false;
          if (where.event?.clientId && row.event.clientId !== where.event.clientId) return false;
          if (where.event?.parcelBookingId && row.event.parcelBookingId !== where.event.parcelBookingId) return false;
          if (where.event?.eventType?.in && !where.event.eventType.in.includes(row.event.eventType)) return false;
          if (where.event?.sequence && (row.event.sequence < where.event.sequence.gte || row.event.sequence > where.event.sequence.lte)) return false;
          return true;
        }).slice(0, args.take);
      },
      updateMany: async args => {
        state.lastDeliveryUpdate = args;
        let count = 0;
        for (const row of state.deliveries) {
          if (args.where.id.in.includes(row.id) && args.where.endpointId === row.endpointId && args.where.status.in.includes(row.status)) {
            Object.assign(row, args.data, {
              attempts: args.data.attempts,
              replayCount: row.replayCount + args.data.replayCount.increment,
            });
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  const prismaClient = {
    ...tx,
    integrationWebhookEndpoint: {
      findFirst: async ({ where }) => where.clientId === "client-1" && where.id === "endpoint-1" ? { id: "endpoint-1" } : null,
    },
    integrationWebhookDelivery: {
      ...tx.integrationWebhookDelivery,
      count: async () => state.deliveries.length,
      findMany: async ({ where, select }) => {
        assert.equal(where.endpoint.clientId, "client-1");
        return state.deliveries.map(row => ({
          id: row.id, eventId: row.eventId, endpointId: row.endpointId,
          status: row.status, attempts: row.attempts, totalAttempts: row.totalAttempts,
          replayCount: row.replayCount, availableAt: row.availableAt,
          lastHttpStatus: row.lastHttpStatus, lastErrorCode: row.lastErrorCode,
          deliveredAt: row.deliveredAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
          event: row.event,
        }));
      },
    },
    $transaction: async work => work(tx),
  };
  return { state, prismaClient, service: createIntegrationWebhookOperationsService({ prismaClient, clock: () => now }) };
}

function delivery({ id = "delivery-1", sequence = 1, status = "DEAD", eventId = "event-1", endpointId = "endpoint-1", clientId = "client-1" } = {}) {
  return {
    id, eventId, endpointId, status, attempts: 8, totalAttempts: 12, replayCount: 0,
    availableAt: new Date("2026-11-07T17:00:00.000Z"),
    lastHttpStatus: 500, lastErrorCode: "WEBHOOK_HTTP_500",
    deliveredAt: null, createdAt: now, updatedAt: now,
    event: {
      id: eventId, clientId, parcelBookingId: "shipment-1",
      eventType: "shipment.created", sequence, occurredAt: now,
      payload: { shipmentReference: "LH-REF-1", status: "IN_TRANSIT" },
    },
  };
}

test("delivery telemetry is client-scoped and excludes secrets and raw response bodies", async () => {
  const { service } = fixture({ deliveries: [delivery()] });
  const result = await service.listDeliveries({ clientId: "client-1", page: 1, limit: 25 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].eventId, "event-1");
  assert.equal(result.items[0].shipmentReference, "LH-REF-1");
  assert.equal(result.items[0].attempts, 8);
  assert.equal(result.items[0].totalAttempts, 12);
  assert.equal("encryptedValue" in result.items[0], false);
  assert.equal("responseBody" in result.items[0], false);
});

test("replay requeues an existing dead delivery without creating or changing its event", async () => {
  const { state, service } = fixture({ deliveries: [delivery()] });
  const result = await service.replayDeliveries({
    clientId: "client-1", credentialId: "credential-1", endpointId: "endpoint-1", eventId: "event-1",
  });
  assert.equal(result.requeuedCount, 1);
  assert.equal(result.scheduledAt, now);
  assert.equal(state.deliveries[0].status, "PENDING");
  assert.equal(state.deliveries[0].attempts, 0);
  assert.equal(state.deliveries[0].replayCount, 1);
  assert.equal(state.deliveries[0].totalAttempts, 12);
  assert.equal(state.audit[0].action, "WEBHOOK_DELIVERY_REPLAY_REQUESTED");
  assert.equal(state.audit[0].metadata.deliveryCount, 1);
  assert.equal(state.deliveries[0].event.sequence, 1);
});

test("sequence replay is shipment-scoped, bounded, and only requeues existing deliveries", async () => {
  const rows = [delivery({ id: "d1", sequence: 2 }), delivery({ id: "d2", sequence: 3, eventId: "event-2" })];
  const { state, service } = fixture({ deliveries: rows });
  const result = await service.replayDeliveries({
    clientId: "client-1", credentialId: "credential-1", endpointId: "endpoint-1",
    shipmentId: "shipment-1", fromSequence: 2, toSequence: 3,
  });
  assert.equal(result.requeuedCount, 2);
  assert.equal(state.lastDeliveryQuery.where.event.parcelBookingId, "shipment-1");
  assert.deepEqual(state.audit[0].metadata.selection, { shipmentId: "shipment-1", fromSequence: 2, toSequence: 3 });
  await assert.rejects(service.replayDeliveries({
    clientId: "client-1", credentialId: "credential-1", endpointId: "endpoint-1",
    shipmentId: "shipment-1", fromSequence: 1, toSequence: 101,
  }), error => error.statusCode === 400);
});

test("replay rejects cross-client, inactive endpoint/client and non-replayable deliveries", async () => {
  const foreign = fixture({ deliveries: [delivery({ clientId: "client-2" })] });
  await assert.rejects(foreign.service.replayDeliveries({
    clientId: "client-1", endpointId: "endpoint-1", eventId: "event-1",
  }), error => error.statusCode === 404);

  const suspended = fixture({ endpointStatus: "SUSPENDED", deliveries: [delivery()] });
  await assert.rejects(suspended.service.replayDeliveries({
    clientId: "client-1", endpointId: "endpoint-1", eventId: "event-1",
  }), error => error.code === "INTEGRATION_WEBHOOK_ENDPOINT_NOT_ACTIVE");

  const inactiveClient = fixture({ clientStatus: "SUSPENDED", deliveries: [delivery()] });
  await assert.rejects(inactiveClient.service.replayDeliveries({
    clientId: "client-1", endpointId: "endpoint-1", eventId: "event-1",
  }), error => error.code === "INTEGRATION_CLIENT_INACTIVE");

  const pending = fixture({ deliveries: [delivery({ status: "PENDING" })] });
  await assert.rejects(pending.service.replayDeliveries({
    clientId: "client-1", endpointId: "endpoint-1", eventId: "event-1",
  }), error => error.statusCode === 404);
});

test("replay is rate-limited using persisted audit records", async () => {
  const { service } = fixture({ auditCount: 10, deliveries: [delivery()] });
  await assert.rejects(service.replayDeliveries({
    clientId: "client-1", endpointId: "endpoint-1", eventId: "event-1",
  }), error => error.statusCode === 429);
});

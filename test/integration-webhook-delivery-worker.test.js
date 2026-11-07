import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createIntegrationWebhookDeliveryWorker,
} from "../src/shared/jobs/integration-webhook-delivery-worker.service.js";
import {
  encryptWebhookSecret,
} from "../src/modules/integrations/integration-webhook.security.js";

const encryptionKey = Buffer.alloc(32, 11).toString("base64");
const now = new Date("2026-11-07T12:00:00.000Z");
const address = { address: "93.184.216.34", family: 4 };
const event = {
  id: "event-1",
  eventType: "shipment.created",
  sequence: 1,
  schemaVersion: 1,
  occurredAt: now,
  payload: { shipmentReference: "LH-PCL-ABC", status: "AWAITING_PARTNER_ASSIGNMENT" },
};
const secret = "lhwhsec_test-signing-secret";
const secretVersionRecord = {
  endpointId: "endpoint-1",
  version: 2,
  ...encryptWebhookSecret(secret, { endpointId: "endpoint-1", version: 2, encryptionKey }),
};

function fixture({ attempts = 1, endpointStatus = "ACTIVE", sendRequest, lookup } = {}) {
  const updates = [];
  const claimed = [{
    id: "delivery-1",
    eventId: event.id,
    endpointId: "endpoint-1",
    secretVersion: 2,
    attempts,
  }];
  const prismaClient = {
    $queryRaw: async () => claimed,
    integrationWebhookDelivery: {
      findUnique: async () => ({
        id: "delivery-1",
        eventId: event.id,
        endpointId: "endpoint-1",
        secretVersion: 2,
        event,
        endpoint: {
          id: "endpoint-1",
          url: "https://hooks.example.org/events",
          status: endpointStatus,
          eventTypes: ["shipment.created"],
          currentSecretVersion: 3,
          client: { status: "ACTIVE" },
        },
        secretVersionRecord,
      }),
      updateMany: async args => {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
  const worker = createIntegrationWebhookDeliveryWorker({
    prismaClient,
    encryptionKey,
    clock: () => new Date(now),
    lookup: lookup ?? (async () => [address]),
    sendRequest: sendRequest ?? (async () => ({ statusCode: 204, responseBody: "" })),
    logger: { info() {}, warn() {}, error() {} },
  });
  return { worker, updates, claimed };
}

test("worker signs the exact raw body and sends pinned-address request headers", async () => {
  let request;
  const { worker, updates } = fixture({
    sendRequest: async args => {
      request = args;
      return { statusCode: 204, responseBody: "" };
    },
  });
  const result = await worker.runOnce();

  assert.deepEqual(result, [{ id: "delivery-1", status: "SUCCEEDED", httpStatus: 204 }]);
  assert.equal(request.address.address, address.address);
  assert.equal(request.url.hostname, "hooks.example.org");
  assert.equal(request.headers["x-logistic-hub-event-id"], event.id);
  assert.equal(request.headers["x-logistic-hub-delivery-id"], "delivery-1");
  assert.equal(request.headers["x-logistic-hub-event-type"], event.eventType);
  assert.equal(request.headers["x-logistic-hub-event-sequence"], "1");
  const timestamp = request.headers["x-logistic-hub-timestamp"];
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${request.body}`, "utf8")
    .digest("hex");
  assert.equal(request.headers["x-logistic-hub-signature"], `t=${timestamp},v1=${expected}`);
  assert.deepEqual(JSON.parse(request.body), {
    id: event.id,
    type: event.eventType,
    schemaVersion: 1,
    occurredAt: now.toISOString(),
    sequence: 1,
    data: event.payload,
  });
  assert.equal(updates[0].data.status, "SUCCEEDED");
  assert.equal(updates[0].data.lastHttpStatus, 204);
});

test("worker retries 429 and 5xx responses but dead-letters permanent 4xx responses", async () => {
  const throttled = fixture({ sendRequest: async () => ({ statusCode: 429, responseBody: "" }) });
  assert.deepEqual(await throttled.worker.runOnce(), [{
    id: "delivery-1", status: "PENDING", httpStatus: 429,
  }]);
  assert.equal(throttled.updates[0].data.status, "PENDING");
  assert.equal(throttled.updates[0].data.lastErrorCode, "WEBHOOK_HTTP_429");
  assert.ok(throttled.updates[0].data.availableAt > now);

  const rejected = fixture({ sendRequest: async () => ({ statusCode: 400, responseBody: "" }) });
  assert.deepEqual(await rejected.worker.runOnce(), [{
    id: "delivery-1", status: "DEAD", httpStatus: 400,
  }]);
  assert.equal(rejected.updates[0].data.status, "DEAD");
});

test("worker dead-letters exhausted retries and never sends to non-public DNS answers", async () => {
  let sent = false;
  const exhausted = fixture({
    attempts: 8,
    sendRequest: async () => { throw new Error("network unavailable"); },
  });
  assert.deepEqual(await exhausted.worker.runOnce(), [{
    id: "delivery-1", status: "DEAD", errorCode: "WEBHOOK_DELIVERY_FAILED",
  }]);
  assert.equal(exhausted.updates[0].data.status, "DEAD");

  const rebound = fixture({
    sendRequest: async () => { sent = true; return { statusCode: 204 }; },
    lookup: async () => [
      address,
      { address: "127.0.0.1", family: 4 },
    ],
  });
  assert.deepEqual(await rebound.worker.runOnce(), [{
    id: "delivery-1", status: "DEAD", errorCode: "WEBHOOK_DNS_NON_PUBLIC",
  }]);
  assert.equal(sent, false);
  assert.equal(rebound.updates[0].data.status, "DEAD");
});

test("worker pauses suspended endpoints and dead-letters revoked endpoints", async () => {
  let sent = false;
  const { worker, updates } = fixture({
    endpointStatus: "SUSPENDED",
    sendRequest: async () => { sent = true; return { statusCode: 204 }; },
  });
  assert.deepEqual(await worker.runOnce(), [{
    id: "delivery-1", status: "PENDING", errorCode: "WEBHOOK_ENDPOINT_SUSPENDED",
  }]);
  assert.equal(sent, false);
  assert.equal(updates[0].data.status, "PENDING");

  const revoked = fixture({ endpointStatus: "REVOKED" });
  assert.deepEqual(await revoked.worker.runOnce(), [{
    id: "delivery-1", status: "DEAD", errorCode: "WEBHOOK_ENDPOINT_NOT_ACTIVE",
  }]);
});

test("worker does not send deliveries for suspended integration clients", async () => {
  let sent = false;
  // The fixture is intentionally replaced with a client-disabled endpoint record.
  const disabledClientFixture = fixture();
  const disabledClientWorker = createIntegrationWebhookDeliveryWorker({
    prismaClient: {
      $queryRaw: async () => disabledClientFixture.claimed,
      integrationWebhookDelivery: {
        findUnique: async () => ({
          id: "delivery-1",
          eventId: event.id,
          endpointId: "endpoint-1",
          secretVersion: 2,
          event,
          endpoint: {
            id: "endpoint-1",
            url: "https://hooks.example.org/events",
            status: "ACTIVE",
            eventTypes: ["shipment.created"],
            currentSecretVersion: 3,
            client: { status: "SUSPENDED" },
          },
          secretVersionRecord,
        }),
        updateMany: async args => { disabledClientFixture.updates.push(args); return { count: 1 }; },
      },
    },
    encryptionKey,
    clock: () => new Date(now),
    logger: { info() {}, warn() {}, error() {} },
    sendRequest: async () => { sent = true; return { statusCode: 204 }; },
    lookup: async () => [address],
  });
  assert.deepEqual(await disabledClientWorker.runOnce(), [{
    id: "delivery-1", status: "DEAD", errorCode: "WEBHOOK_CLIENT_NOT_ACTIVE",
  }]);
  assert.equal(sent, false);
  assert.equal(disabledClientFixture.updates[0].data.status, "DEAD");
});

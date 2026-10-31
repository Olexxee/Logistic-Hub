import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationsService } from "../src/modules/notifications/notifications.service.js";
import { decryptJobPayload } from "../src/shared/jobs/outbox-crypto.js";

const encryptionKey = Buffer.alloc(32, 9).toString("base64");

function mockPrisma({ existing = null } = {}) {
  const calls = { created: [], updated: [], queued: [], emailLookups: 0 };
  const notification = {
    id: "notification_1",
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    data: { bookingId: "booking_1" },
    readAt: null,
    emailStatus: "PENDING",
    emailSentAt: null,
    emailProviderId: null,
    emailErrorCode: null,
    deliveryKey: "delivery_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const client = {
    $transaction: async (callback) => callback(client),
    notification: {
      findUnique: async () => existing,
      create: async ({ data }) => {
        calls.created.push(data);
        return { ...notification, ...data };
      },
      update: async ({ data }) => {
        calls.updated.push(data);
        return { ...notification, ...data };
      },
      findMany: async () => [],
      count: async () => 0,
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
    user: { findUnique: async () => {
      calls.emailLookups += 1;
      return { email: "customer@example.com", status: "ACTIVE", emailVerifiedAt: new Date() };
    } },
    outboxJob: {
      upsert: async ({ create }) => {
        calls.queued.push(create);
        return { id: "job_1", status: "PENDING" };
      },
    },
  };
  return { calls, client, notification };
}

test("notification and encrypted email job are persisted without calling the provider", async () => {
  const mock = mockPrisma();
  const service = createNotificationsService({ prismaClient: mock.client, encryptionKey });
  const result = await service.createAndDeliver({
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    data: { bookingId: "booking_1" },
    deliveryKey: "delivery_1",
    emailSubject: "Your booking has an update",
  });
  assert.equal(result.emailStatus, "PENDING");
  assert.equal(mock.calls.created.length, 1);
  assert.equal(mock.calls.queued.length, 1);
  assert.equal(mock.calls.queued[0].idempotencyKey, "delivery_1");
  const payload = decryptJobPayload(mock.calls.queued[0].encryptedPayload, encryptionKey);
  assert.equal(payload.to, "customer@example.com");
  assert.equal(payload.subject, "Your booking has an update");
  assert.equal(payload.notificationId, "notification_1");
});

test("notification is retained and marked failed when recipient email is unavailable", async () => {
  const mock = mockPrisma();
  mock.client.user.findUnique = async () => null;
  const service = createNotificationsService({ prismaClient: mock.client, encryptionKey });
  const result = await service.createAndDeliver({
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    deliveryKey: "delivery_1",
    emailSubject: "Your booking has an update",
  });
  assert.equal(result.emailStatus, "FAILED");
  assert.equal(mock.calls.queued.length, 0);
  assert.equal(mock.calls.updated[0].emailErrorCode, "RECIPIENT_EMAIL_UNAVAILABLE");
});

test("already delivered notification is idempotently returned without queueing another job", async () => {
  const mock = mockPrisma({ existing: { ...mockPrisma().notification, emailStatus: "SENT" } });
  const service = createNotificationsService({ prismaClient: mock.client, encryptionKey });
  const result = await service.createAndDeliver({
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    deliveryKey: "delivery_1",
    emailSubject: "Your booking has an update",
  });
  assert.equal(result.emailStatus, "SENT");
  assert.equal(mock.calls.queued.length, 0);
});

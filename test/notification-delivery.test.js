import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationsService } from "../src/modules/notifications/notifications.service.js";

function mockPrisma({ existing = null } = {}) {
  const calls = { created: [], updated: [], emailLookups: 0 };
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
  return {
    calls,
    client: {
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
    },
    notification,
  };
}

test("notification delivery persists a sent state and provider id", async () => {
  const mock = mockPrisma();
  let sent;
  const service = createNotificationsService({
    prismaClient: mock.client,
    email: { send: async (input) => { sent = input; return { id: "resend_123", accepted: true }; } },
    clock: () => new Date("2026-01-02T00:00:00.000Z"),
  });
  const result = await service.createAndDeliver({
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    data: { bookingId: "booking_1" },
    deliveryKey: "delivery_1",
    emailSubject: "Your booking has an update",
  });
  assert.equal(result.emailStatus, "SENT");
  assert.equal(mock.calls.updated[0].emailProviderId, "resend_123");
  assert.equal(sent.idempotencyKey, "delivery_1");
  assert.equal(sent.to, "customer@example.com");
});

test("notification delivery records a safe failure code and keeps the in-app notification", async () => {
  const mock = mockPrisma();
  const service = createNotificationsService({
    prismaClient: mock.client,
    email: { send: async () => { const error = new Error("private error"); error.code = "EMAIL_PROVIDER_UNAVAILABLE"; throw error; } },
  });
  const result = await service.createAndDeliver({
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    deliveryKey: "delivery_1",
    emailSubject: "Your booking has an update",
  });
  assert.equal(result.emailStatus, "FAILED");
  assert.equal(mock.calls.updated[0].emailErrorCode, "EMAIL_PROVIDER_UNAVAILABLE");
  assert.equal(mock.calls.created.length, 1);
});

test("already delivered notification is idempotently returned without resending", async () => {
  const mock = mockPrisma({ existing: { ...mockPrisma().notification, emailStatus: "SENT" } });
  let sends = 0;
  const service = createNotificationsService({
    prismaClient: mock.client,
    email: { send: async () => { sends += 1; return { id: "unused" }; } },
  });
  const result = await service.createAndDeliver({
    userId: "user_1",
    type: "BOOKING_UPDATE",
    title: "Booking update",
    body: "A driver proposed a fare.",
    deliveryKey: "delivery_1",
    emailSubject: "Your booking has an update",
  });
  assert.equal(result.emailStatus, "SENT");
  assert.equal(sends, 0);
});

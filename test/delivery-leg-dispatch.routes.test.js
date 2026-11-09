import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDeliveryLegDispatchRouter } from "../src/modules/delivery-legs/delivery-leg-dispatch.routes.js";
import { requireRole } from "../src/modules/auth/auth.middleware.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

const now = new Date();
const leg = {
  id: "leg-1",
  parcelBookingId: "booking-1",
  sequence: 1,
  type: "LOCAL_PICKUP",
  status: "READY_FOR_ASSIGNMENT",
  originHubPointId: "hub-1",
  originLatitude: 6.6018,
  originLongitude: 3.3515,
  originServiceZoneId: "zone-1",
  destinationServiceZoneId: "zone-1",
  parcelBooking: { id: "booking-1", senderId: "sender-1", currency: "NGN" },
};
const driver = {
  id: "driver-profile-1",
  serviceRadiusMeters: 5000,
  verificationStatus: "VERIFIED",
  kycTier: "FULL",
  suspendedAt: null,
  isOnline: true,
  isAvailable: true,
  lastLocationAt: new Date(now.getTime() - 10_000),
  locations: [{ latitude: 6.602, longitude: 3.352, recordedAt: new Date(now.getTime() - 10_000) }],
};

function createApp({ canDispatch = true } = {}) {
  const state = { createdOffers: [], events: [] };
  const tx = {
    deliveryLeg: { findUnique: async () => leg },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE" }) },
    hubPointOperator: {
      findUnique: async () => ({
        hubPointId: "hub-1", userId: "hub-operator-1",
        role: "OPERATOR", isActive: true, canDispatch,
      }),
    },
    deliveryLegOffer: {
      findMany: async () => [],
      createMany: async ({ data }) => { state.createdOffers.push(...data); return { count: data.length }; },
    },
    driverProfile: { findMany: async () => [driver] },
    serviceZone: { findMany: async () => [{ id: "zone-1" }] },
    bookingEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
  };
  const prismaClient = { $transaction: callback => callback(tx) };
  const authMiddleware = (req, _res, next) => {
    req.user = { id: "hub-operator-1", role: "CUSTOMER" };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createDeliveryLegDispatchRouter({
    prismaClient, authMiddleware, roleMiddleware: requireRole,
  }));
  app.use(errorHandler);
  return { app, state };
}

async function withServer(app, run) {
  const server = app.listen(0);
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("hub dispatch endpoint permits matching only with explicit membership delegation", async () => {
  const { app, state } = createApp({ canDispatch: true });
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/hub-operations/hubs/hub-1/delivery-legs/leg-1/request-matching`, {
      method: "POST",
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.data.offersCreated, 1);
    assert.equal(state.createdOffers.length, 1);
    assert.equal(state.events[0].actorUserId, "hub-operator-1");
    assert.equal(state.events[0].eventType, "DELIVERY_LEG_MATCHING_REQUESTED");
  });
});

test("hub dispatch endpoint rejects members without explicit delegation", async () => {
  const { app, state } = createApp({ canDispatch: false });
  await withServer(app, async base => {
    const response = await fetch(`${base}/api/v1/hub-operations/hubs/hub-1/delivery-legs/leg-1/request-matching`, {
      method: "POST",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(state.createdOffers, []);
    assert.deepEqual(state.events, []);
  });
});

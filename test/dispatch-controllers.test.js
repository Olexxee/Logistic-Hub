import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchController } from "../src/modules/dispatch/dispatch.controller.js";
import { createRideDispatchController } from "../src/modules/rides/ride-dispatch.controller.js";

function response() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("parcel matching replay does not resend matching notifications", async () => {
  let notifications = 0;
  const controller = createDispatchController({
    service: {
      requestParcelMatching: async () => ({
        bookingId: "booking_1", status: "MATCHING", offersCreated: 3, replay: true,
      }),
    },
    notifications: { notifyMatchingOffers: async () => { notifications += 1; } },
  });
  const res = response();
  await controller.requestMatching({ validated: { params: { bookingId: "booking_1" } }, user: { id: "sender_1" } }, res);
  assert.equal(res.statusCode, 202);
  assert.equal(notifications, 0);
});

test("parcel fare proposal replay does not resend fare notifications", async () => {
  let notifications = 0;
  const controller = createDispatchController({
    service: {
      proposeParcelFare: async () => ({
        offerId: "offer_1", proposedFareMinor: "2500", currency: "NGN", status: "OFFERED", replay: true,
      }),
    },
    notifications: { notifyFareProposed: async () => { notifications += 1; } },
  });
  const res = response();
  await controller.proposeFare({
    validated: { params: { offerId: "offer_1" }, body: { proposedFareMinor: "2500" }, idempotencyKey: "key-123456789" },
    user: { id: "driver_1" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(notifications, 0);
});

test("ride fare proposal replay does not resend fare notifications", async () => {
  let notifications = 0;
  const controller = createRideDispatchController({
    service: {
      proposeFare: async () => ({
        offerId: "offer_2", proposedFareMinor: "3500", currency: "NGN", status: "OFFERED", replay: true,
      }),
    },
    notifications: { notifyFareProposed: async () => { notifications += 1; } },
  });
  const res = response();
  await controller.proposeFare({
    validated: { params: { offerId: "offer_2" }, body: { proposedFareMinor: "3500" }, idempotencyKey: "key-123456789" },
    user: { id: "driver_2" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(notifications, 0);
});

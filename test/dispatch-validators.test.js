import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDispatchBookingId,
  validateDispatchOfferId,
  validateProposeParcelFare,
  validateAcceptParcelFare,
  validateDispatchIdempotencyKey,
} from "../src/modules/dispatch/dispatch.validators.js";
import {
  validateRideBookingId,
  validateRideOfferId,
  validateProposeRideFare,
  validateAcceptRideFare,
  validateRideDispatchIdempotencyKey,
} from "../src/modules/rides/ride-dispatch.validators.js";

function request({ params = {}, body = {}, headers = {} } = {}) {
  return {
    params, body, headers, validated: {},
    get(name) { return headers[name] ?? headers[name.toLowerCase()]; },
  };
}
function run(middleware, req) {
  let forwarded;
  middleware(req, {}, (error) => { forwarded = error ?? null; });
  return forwarded;
}
const key = "dispatch-test-key-001";

test("parcel dispatch validators accept valid params, fare bodies and idempotency keys", () => {
  const req = request({ params: { bookingId: "booking_1" } });
  assert.equal(run(validateDispatchBookingId, req), null);
  assert.equal(req.validated.params.bookingId, "booking_1");

  const offerReq = request({ params: { offerId: "offer_1" } });
  assert.equal(run(validateDispatchOfferId, offerReq), null);
  assert.equal(offerReq.validated.params.offerId, "offer_1");

  const fareReq = request({ body: { proposedFareMinor: "2500" } });
  assert.equal(run(validateProposeParcelFare, fareReq), null);
  assert.equal(fareReq.validated.body.proposedFareMinor, "2500");

  const acceptReq = request({ body: { offerId: "offer_1" } });
  assert.equal(run(validateAcceptParcelFare, acceptReq), null);
  assert.equal(acceptReq.validated.body.offerId, "offer_1");

  const keyReq = request({ headers: { "Idempotency-Key": key } });
  assert.equal(run(validateDispatchIdempotencyKey, keyReq), null);
  assert.equal(keyReq.validated.idempotencyKey, key);
});

test("ride dispatch validators accept valid params, fare bodies and idempotency keys", () => {
  const bookingReq = request({ params: { rideBookingId: "ride_1" } });
  assert.equal(run(validateRideBookingId, bookingReq), null);
  assert.equal(bookingReq.validated.params.rideBookingId, "ride_1");

  const offerReq = request({ params: { offerId: "offer_2" } });
  assert.equal(run(validateRideOfferId, offerReq), null);
  assert.equal(offerReq.validated.params.offerId, "offer_2");

  const fareReq = request({ body: { proposedFareMinor: "3500" } });
  assert.equal(run(validateProposeRideFare, fareReq), null);
  assert.equal(fareReq.validated.body.proposedFareMinor, "3500");

  const acceptReq = request({ body: { offerId: "offer_2" } });
  assert.equal(run(validateAcceptRideFare, acceptReq), null);
  assert.equal(acceptReq.validated.body.offerId, "offer_2");

  const keyReq = request({ headers: { "Idempotency-Key": key } });
  assert.equal(run(validateRideDispatchIdempotencyKey, keyReq), null);
  assert.equal(keyReq.validated.idempotencyKey, key);
});

test("dispatch validators forward centralized validation errors for invalid input", () => {
  for (const [middleware, req] of [
    [validateDispatchBookingId, request({ params: { bookingId: "" } })],
    [validateDispatchOfferId, request({ params: { offerId: "" } })],
    [validateProposeParcelFare, request({ body: { proposedFareMinor: "0" } })],
    [validateAcceptParcelFare, request({ body: {} })],
    [validateDispatchIdempotencyKey, request({ headers: { "Idempotency-Key": "bad" } })],
    [validateRideBookingId, request({ params: { rideBookingId: "" } })],
    [validateRideOfferId, request({ params: { offerId: "" } })],
    [validateProposeRideFare, request({ body: { proposedFareMinor: "1.5" } })],
    [validateAcceptRideFare, request({ body: {} })],
    [validateRideDispatchIdempotencyKey, request({ headers: {} })],
  ]) {
    const error = run(middleware, req);
    assert.equal(error?.code, "VALIDATION_ERROR");
    assert.equal(error?.statusCode, 400);
  }
});

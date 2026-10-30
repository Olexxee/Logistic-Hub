import test from "node:test";
import assert from "node:assert/strict";
import { isDriverAssignableDeliveryLeg } from "../src/modules/delivery-legs/leg-dispatch.service.js";

test("only ready local pickup, final-mile and direct legs can be dispatched to local drivers", () => {
  for (const type of ["LOCAL_PICKUP", "FINAL_MILE", "DIRECT"]) {
    assert.equal(isDriverAssignableDeliveryLeg({ type, status: "READY_FOR_ASSIGNMENT" }), true);
  }
  assert.equal(isDriverAssignableDeliveryLeg({ type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT" }), false);
});

test("planned, assigned and awaiting-payment legs cannot receive new driver offers", () => {
  for (const status of ["PLANNED", "AWAITING_PAYMENT", "ASSIGNED", "IN_TRANSIT", "COMPLETED", "FAILED", "CANCELLED"]) {
    assert.equal(isDriverAssignableDeliveryLeg({ type: "LOCAL_PICKUP", status }), false);
  }
});

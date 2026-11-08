import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerExecutionService } from "./partner-execution.service.js";

test("integration delivery legs cannot be assigned before dispatch authorization", async () => {
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => null,
    },
    deliveryLeg: {
      findUnique: async () => ({
        id: "leg_1",
        type: "INTERSTATE_TRANSPORT",
        status: "READY_FOR_ASSIGNMENT",
        parcelBookingId: "booking_1",
        parcelBooking: {
          id: "booking_1",
          paymentStatus: "SUCCEEDED",
          status: "AWAITING_PARTNER_ASSIGNMENT",
          integrationClientId: "market_iq",
          integrationDispatchAuthorizedAt: null,
        },
      }),
    },
  };
  const prismaClient = {
    $transaction: async callback => callback(tx),
  };
  const service = createPartnerExecutionService({ prismaClient });

  const result = await service.assignLeg({
    deliveryLegId: "leg_1",
    partnerId: "partner_1",
    idempotencyKey: "assignment-key-0001",
    actorUserId: "admin_1",
  });

  assert.deepEqual(result, { blocker: "INTEGRATION_DISPATCH_REVIEW_PENDING" });
});

import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentsRepository } from "../src/modules/payments/payments.repository.js";

function createSettlementClient({ amountMinor = 2850, currency = "NGN" } = {}) {
  const writes = [];
  const attempt = {
    id: "attempt_1",
    provider: "PAYSTACK",
    status: "PENDING",
    amountMinor: 2850n,
    currency: "NGN",
    platformAllocationMinor: 300n,
    parcelBookingId: "booking_1",
    rideBookingId: null,
  };
  const tx = {
    providerWebhookEvent: {
      findUnique: async () => null,
      create: async ({ data }) => { writes.push(["webhook.create", data]); return data; },
      update: async ({ data }) => { writes.push(["webhook.update", data]); return data; },
    },
    paymentAttempt: {
      findUnique: async () => attempt,
      update: async ({ data }) => { writes.push(["paymentAttempt.update", data]); return { ...attempt, ...data }; },
    },
    parcelBooking: {
      findUnique: async () => ({
        id: "booking_1",
        senderId: "sender_1",
        publicReference: "LH-PCL-1",
        paymentStatus: "PENDING",
      }),
      update: async ({ data }) => { writes.push(["parcelBooking.update", data]); return data; },
    },
    driverAssignment: {
      updateMany: async ({ where, data }) => { writes.push(["assignment.updateMany", { where, data }]); return { count: 1 }; },
    },
    deliveryLeg: {
      updateMany: async ({ where, data }) => { writes.push(["deliveryLeg.updateMany", { where, data }]); return { count: 1 }; },
    },
    bookingEvent: {
      create: async ({ data }) => { writes.push(["bookingEvent.create", data]); return data; },
    },
    ledgerAccount: {
      upsert: async ({ where }) => ({ id: where.code }),
    },
    ledgerEntry: {
      findFirst: async () => null,
      createMany: async ({ data }) => { writes.push(["ledgerEntry.createMany", data]); return { count: data.length }; },
    },
  };
  const prismaClient = {
    $transaction: async (callback) => callback(tx),
  };
  return {
    repository: createPaymentsRepository(prismaClient),
    writes,
    settle: () => createPaymentsRepository(prismaClient).settle({
      reference: "LH-REF-1",
      amountMinor,
      currency,
      providerPayload: { verified: true },
      providerEventId: "event_1",
      eventType: "charge.success",
      payloadHash: "payload-hash",
    }),
  };
}

test("verified parcel payment activates the linked delivery leg in the settlement transaction", async () => {
  const { settle, writes } = createSettlementClient();
  const result = await settle();

  assert.equal(result.status, "settled");
  assert.equal(result.bookingType, "PARCEL");
  const legUpdate = writes.find(([name]) => name === "deliveryLeg.updateMany")[1];
  assert.deepEqual(legUpdate.where, { parcelBookingId: "booking_1", status: "AWAITING_PAYMENT" });
  assert.equal(legUpdate.data.status, "ASSIGNED");
  assert.ok(legUpdate.data.assignedAt instanceof Date);
  assert.equal(writes.find(([name]) => name === "assignment.updateMany")[1].data.status, "ACCEPTED");
  assert.equal(writes.find(([name]) => name === "parcelBooking.update")[1].paymentStatus, "SUCCEEDED");
});

test("payment amount mismatch cannot activate the assignment or delivery leg", async () => {
  const { settle, writes } = createSettlementClient({ amountMinor: 2851 });
  await assert.rejects(settle(), { code: "PAYMENT_AMOUNT_MISMATCH", statusCode: 409 });
  assert.equal(writes.some(([name]) => name === "deliveryLeg.updateMany"), false);
  assert.equal(writes.some(([name]) => name === "assignment.updateMany"), false);
});

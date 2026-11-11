import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentsService } from "../src/modules/payments/payments.service.js";

function platformBooking({ agreedFareMinor = 3500n, snapshotPayout = "3500" } = {}) {
  return {
    id: "booking_customer_1",
    status: "AWAITING_PAYMENT",
    paymentStatus: "INITIALIZED",
    customerPayableMinor: 9000n,
    currency: "NGN",
    pricingSnapshot: {
      source: "PLATFORM_ROUTE_RATE",
      driverPayoutMinor: snapshotPayout,
    },
    assignments: [{
      id: "assignment_1",
      status: "AWAITING_PAYMENT",
      agreedFareMinor,
      driverProfile: {
        settlementAccounts: [{
          id: "settlement_1",
          externalAccountRef: "ACCT_platform_driver",
          status: "ACTIVE",
        }],
      },
    }],
  };
}

test("platform-route payment uses the exact reserved driver payout and platform remainder", async () => {
  let attemptData;
  const repository = {
    findBooking: async () => platformBooking(),
    createAttempt: async data => {
      attemptData = data;
      return {
        id: "attempt_1",
        amountMinor: data.amountMinor,
        parcelBookingId: data.parcelBookingId,
        rideBookingId: null,
        providerReference: data.providerReference,
        providerPayload: null,
      };
    },
    findUserEmail: async () => ({ email: "customer@example.test" }),
    saveAuthorization: async () => {},
  };
  const service = createPaymentsService({
    prismaClient: {},
    repository,
    notifications: {},
    secretKey: "sk_test_key",
    enabled: true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ status: true, data: { authorization_url: "https://paystack.test/authorize", access_code: "access_1" } }),
    }),
  });

  const result = await service.initialize({
    bookingType: "PARCEL",
    bookingId: "booking_customer_1",
    userId: "customer_1",
    idempotencyKey: "customer-platform-payment-0001",
  });

  assert.equal(result.amountMinor, "9000");
  assert.equal(attemptData.driverAllocationMinor, 3500n);
  assert.equal(attemptData.platformAllocationMinor, 5500n);
  assert.equal(attemptData.splitConfigurationSnapshot.platformFeeModel, "PLATFORM_RETAINED_REMAINDER");
  assert.equal(attemptData.splitConfigurationSnapshot.driverPayoutMinor, "3500");
  assert.equal(attemptData.splitConfigurationSnapshot.customerChargeMinor, "9000");
});

test("platform-route payment fails closed when the assignment payout differs from the accepted tariff", async () => {
  let createAttemptCalled = false;
  const repository = {
    findBooking: async () => platformBooking({ agreedFareMinor: 3000n, snapshotPayout: "3500" }),
    createAttempt: async () => { createAttemptCalled = true; throw new Error("must not create an attempt"); },
  };
  const service = createPaymentsService({
    prismaClient: {},
    repository,
    notifications: {},
    secretKey: "sk_test_key",
    enabled: true,
  });

  await assert.rejects(
    service.initialize({
      bookingType: "PARCEL",
      bookingId: "booking_customer_1",
      userId: "customer_1",
      idempotencyKey: "customer-platform-payment-0002",
    }),
    error => error.code === "DRIVER_PAYOUT_SNAPSHOT_MISMATCH",
  );
  assert.equal(createAttemptCalled, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryService } from "../src/modules/discovery/discovery.service.js";

test("driver assignment discovery returns active work with string minor-unit amounts", async () => {
  const repository = {
    findDriverProfile: async () => ({ id: "driver-profile-1" }),
    listDriverAssignments: async ({ statuses }) => {
      assert.deepEqual(statuses, ["ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"]);
      return [{
        id: "assignment-1", status: "ACCEPTED", agreedFareMinor: 125000n, currency: "NGN",
        acceptedAt: new Date("2026-10-30T10:00:00.000Z"), pickupAt: null, startedAt: null, completedAt: null,
        parcelBooking: { id: "booking-1", publicReference: "LH-PCL-1", status: "DRIVER_ASSIGNED", pickupAddress: "Ikeja", destinationAddress: "Yaba", recipientName: "Recipient", recipientPhone: "08000000000" },
        rideBooking: null,
        deliveryLeg: { id: "leg-1", sequence: 1, type: "LOCAL_DELIVERY", status: "ASSIGNED", originServiceZone: { id: "zone-1", name: "Ikeja" }, destinationServiceZone: { id: "zone-2", name: "Yaba" }, originHubPoint: null, destinationHubPoint: null },
      }];
    },
  };
  const service = createDiscoveryService({ prismaClient: {}, repository });
  const result = await service.listDriverAssignments({ userId: "driver-user-1", limit: 10 });
  assert.equal(result.items[0].agreedFareMinor, "125000");
  assert.equal(result.items[0].booking.bookingType, "PARCEL");
  assert.equal(result.items[0].deliveryLeg.id, "leg-1");
  assert.equal(result.pagination.hasMore, false);
});

test("driver assignment discovery returns an empty result when the user has no driver profile", async () => {
  const repository = { findDriverProfile: async () => null };
  const service = createDiscoveryService({ prismaClient: {}, repository });
  const result = await service.listDriverAssignments({ userId: "customer-1", limit: 20 });
  assert.deepEqual(result, { items: [], pagination: { limit: 20, hasMore: false, nextCursor: null } });
});

test("admin user search delegates bounded pagination and computes page metadata", async () => {
  const repository = {
    searchUsers: async input => {
      assert.equal(input.skip, 25);
      assert.equal(input.take, 25);
      assert.equal(input.query, "ada");
      return { items: [{ id: "user-1", fullName: "Ada" }], total: 26 };
    },
  };
  const service = createDiscoveryService({ prismaClient: {}, repository });
  const result = await service.searchUsers({ query: "ada", page: 2, limit: 25 });
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.items[0].id, "user-1");
});

test("payment attempt read is owner-scoped and does not expose provider payload or references", async () => {
  const repository = {
    findPaymentAttempt: async () => ({
      id: "payment-1", provider: "PAYSTACK", status: "SUCCEEDED", amountMinor: 250000n,
      currency: "NGN", initializedAt: new Date("2026-10-30T10:00:00.000Z"),
      verifiedAt: new Date("2026-10-30T10:01:00.000Z"), failedAt: null,
      providerReference: "secret-reference", providerPayload: { authorizationUrl: "https://secret.invalid" },
      parcelBooking: { id: "booking-1", publicReference: "LH-PCL-1", status: "COMPLETED", paymentStatus: "SUCCEEDED", senderId: "owner-1" },
      rideBooking: null,
    }),
  };
  const service = createDiscoveryService({ prismaClient: {}, repository });
  const result = await service.getPaymentAttempt({ paymentAttemptId: "payment-1", user: { id: "owner-1", role: "CUSTOMER" } });
  assert.equal(result.amountMinor, "250000");
  assert.equal(result.booking.bookingType, "PARCEL");
  assert.equal("providerPayload" in result, false);
  assert.equal("providerReference" in result, false);
  await assert.rejects(
    service.getPaymentAttempt({ paymentAttemptId: "payment-1", user: { id: "other-user", role: "CUSTOMER" } }),
    error => error.statusCode === 403 && error.code === "FORBIDDEN",
  );
});

test("partner and hub membership discovery return repository-owned memberships", async () => {
  const repository = {
    listUserPartnerMemberships: async () => [{ id: "partner-membership-1", isActive: true }],
    listUserHubMemberships: async () => [{ id: "hub-membership-1", isActive: false }],
  };
  const service = createDiscoveryService({ prismaClient: {}, repository });
  assert.equal((await service.listUserPartnerMemberships({ userId: "user-1" })).items[0].id, "partner-membership-1");
  assert.equal((await service.listUserHubMemberships({ userId: "user-1" })).items[0].id, "hub-membership-1");
});

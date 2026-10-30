import test from "node:test";
import assert from "node:assert/strict";
import { createParcelBookingsService } from "../src/modules/parcels/parcel-bookings.service.js";

test("admin parcel booking list applies operational filters and pagination", async () => {
  let received;
  const repository = {
    listVisible: async input => {
      received = input;
      return { items: [], total: 0 };
    },
  };
  const service = createParcelBookingsService({ prismaClient: {}, repository });
  const result = await service.listVisibleBookings({
    user: { id: "admin-1", role: "ADMIN" },
    page: 2,
    limit: 10,
    status: "IN_TRANSIT",
    paymentStatus: "SUCCEEDED",
    reference: "LH-PCL",
    pickupServiceZoneId: "zone-1",
    destinationServiceZoneId: "zone-2",
    createdFrom: "2026-10-01T00:00:00.000Z",
    createdTo: "2026-10-30T23:59:59.000Z",
  });
  assert.equal(received.includeAll, true);
  assert.equal(received.senderId, "admin-1");
  assert.equal(received.skip, 10);
  assert.equal(received.take, 10);
  assert.equal(received.paymentStatus, "SUCCEEDED");
  assert.equal(received.reference, "LH-PCL");
  assert.equal(received.pickupServiceZoneId, "zone-1");
  assert.equal(received.destinationServiceZoneId, "zone-2");
  assert.equal(received.createdFrom instanceof Date, true);
  assert.equal(received.createdTo instanceof Date, true);
  assert.equal(result.pagination.total, 0);
});

test("customers cannot use administrative booking queue filters", async () => {
  const repository = { listVisible: async () => ({ items: [], total: 0 }) };
  const service = createParcelBookingsService({ prismaClient: {}, repository });
  await assert.rejects(
    service.listVisibleBookings({
      user: { id: "customer-1", role: "CUSTOMER" },
      page: 1, limit: 20, reference: "LH-PCL",
    }),
    error => error.statusCode === 403,
  );
});

test("customer parcel list remains scoped to the authenticated sender", async () => {
  let received;
  const repository = {
    listVisible: async input => { received = input; return { items: [], total: 0 }; },
  };
  const service = createParcelBookingsService({ prismaClient: {}, repository });
  await service.listVisibleBookings({
    user: { id: "customer-1", role: "CUSTOMER" }, page: 1, limit: 20, status: "DRAFT",
  });
  assert.equal(received.includeAll, false);
  assert.equal(received.senderId, "customer-1");
  assert.equal(received.status, "DRAFT");
});

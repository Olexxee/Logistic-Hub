import test from "node:test";
import assert from "node:assert/strict";
import { createParcelBookingsService } from "../src/modules/parcels/parcel-bookings.service.js";

const booking = {
  id: "booking-1",
  senderId: "customer-1",
  publicReference: "LH-PCL-ABC123",
  status: "IN_TRANSIT",
  paymentStatus: "SUCCEEDED",
  currency: "NGN",
  pickupServiceZoneId: "zone-1",
  destinationServiceZoneId: "zone-2",
  pickupAddress: "Pickup address",
  pickupLatitude: 6.5244,
  pickupLongitude: 3.3792,
  pickupInstructions: null,
  destinationAddress: "Destination address",
  destinationLatitude: 6.525,
  destinationLongitude: 3.38,
  recipientName: "Recipient",
  recipientPhone: "+2348000000000",
  parcelCategory: "GENERAL",
  parcelDescription: "Parcel",
  parcelSize: "SMALL",
  parcelPackages: [],
  declaredValueMinor: 500000n,
  handlingInstructions: null,
  driverFareMinor: 25000n,
  connectionFeeMinor: 1000n,
  otherChargesMinor: 0n,
  customerPayableMinor: 26000n,
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-02T00:00:00.000Z"),
};

const leg = {
  id: "leg-1",
  sequence: 1,
  type: "INTERSTATE_TRANSPORT",
  status: "IN_TRANSIT",
  originServiceZone: { id: "zone-1", name: "Origin Zone" },
  destinationServiceZone: { id: "zone-2", name: "Destination Zone" },
  originHubPoint: { id: "hub-1", name: "Origin Hub" },
  destinationHubPoint: { id: "hub-2", name: "Destination Hub" },
  plannedAt: null,
  assignedAt: new Date("2026-11-02T00:00:00.000Z"),
  pickedUpAt: null,
  startedAt: new Date("2026-11-02T01:00:00.000Z"),
  completedAt: null,
  failureReason: null,
  assignments: [{
    id: "driver-assignment-1",
    status: "IN_PROGRESS",
    acceptedAt: null,
    pickupAt: null,
    startedAt: new Date("2026-11-02T01:00:00.000Z"),
    completedAt: null,
    agreedFareMinor: 25000n,
    driverProfileId: "private-driver-id",
  }],
  partnerAssignments: [{
    id: "partner-assignment-1",
    status: "IN_TRANSIT",
    partner: { id: "private-partner-id", displayName: "Private Partner" },
  }],
  metadata: {
    pricingSource: "PLATFORM_OPERATIONAL_TARIFF",
    executionSnapshotId: "private-snapshot-id",
    executionCostMinor: "18000",
    selectedPartnerId: "private-partner-id",
  },
  executionSnapshot: {
    id: "private-snapshot-id",
    executorType: "TRANSPORT_PARTNER",
    selectedPartnerId: "private-partner-id",
    executionCostMinor: 18000n,
    costSource: "PARTNER_RATE_CARD",
    costSourceVersion: 4,
  },
  createdAt: new Date("2026-11-02T00:00:00.000Z"),
  updatedAt: new Date("2026-11-02T01:00:00.000Z"),
};

function service() {
  return createParcelBookingsService({
    prismaClient: {},
    repository: {
      findById: async () => booking,
      findDeliveryLegsByBookingId: async () => [leg],
    },
  });
}

test("customer booking serialization excludes internal execution and partner cost data", async () => {
  const result = await service().getVisibleBooking({
    bookingId: booking.id,
    user: { id: booking.senderId, role: "CUSTOMER" },
  });

  assert.equal(result.id, booking.id);
  assert.equal(result.customerPayableMinor, "26000");
  for (const forbidden of [
    "executionSnapshot",
    "executionSnapshotId",
    "executionCostMinor",
    "costSource",
    "costSourceVersion",
    "selectedPartnerId",
    "partnerId",
    "driverProfileId",
    "pricingSnapshot",
    "senderId",
  ]) {
    assert.equal(Object.hasOwn(result, forbidden), false, `unexpected booking field: ${forbidden}`);
  }
});

test("customer delivery-leg serialization exposes progress but not executor snapshots or internal costs", async () => {
  const [result] = await service().listVisibleDeliveryLegs({
    bookingId: booking.id,
    user: { id: booking.senderId, role: "CUSTOMER" },
  });

  assert.equal(result.id, leg.id);
  assert.equal(result.status, "IN_TRANSIT");
  assert.equal(result.assignment.status, "IN_PROGRESS");
  for (const forbidden of [
    "metadata",
    "executionSnapshot",
    "executionSnapshotId",
    "executionCostMinor",
    "costSource",
    "costSourceVersion",
    "selectedPartnerId",
    "partnerId",
    "partnerAssignment",
    "partnerAssignments",
    "driverProfileId",
  ]) {
    assert.equal(Object.hasOwn(result, forbidden), false, `unexpected delivery-leg field: ${forbidden}`);
  }
  assert.equal(JSON.stringify(result).includes("private-snapshot-id"), false);
  assert.equal(JSON.stringify(result).includes("private-partner-id"), false);
});

test("admin operational-trip partner details remain explicitly role-gated", async () => {
  const adminLeg = {
    ...leg,
    metadata: { pricingSource: "ADMIN_OPERATIONAL_TRIP", executionType: "TRANSPORT_PARTNER", partnerId: "admin-visible-partner" },
  };
  const adminService = createParcelBookingsService({
    prismaClient: {},
    repository: {
      findById: async () => booking,
      findDeliveryLegsByBookingId: async () => [adminLeg],
    },
  });
  const [adminResult] = await adminService.listVisibleDeliveryLegs({
    bookingId: booking.id,
    user: { id: "admin-1", role: "ADMIN" },
  });
  assert.equal(adminResult.operationalExecutionType, "TRANSPORT_PARTNER");
  assert.equal(adminResult.operationalPartnerId, "admin-visible-partner");

  const [supportResult] = await adminService.listVisibleDeliveryLegs({
    bookingId: booking.id,
    user: { id: "support-1", role: "SUPPORT" },
  });
  assert.equal(Object.hasOwn(supportResult, "operationalPartnerId"), false);
});

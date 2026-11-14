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

test("partner assignment revalidates and assigns an approved hub-recovery continuation from its immutable executor snapshot", async () => {
  const now = new Date("2026-11-13T18:00:00.000Z");
  const packages = [{
    id: "package-1", packageSequence: 1, packageCategory: "GENERAL",
    weightGrams: 500, lengthMm: 100, widthMm: 100, heightMm: 100,
  }];
  const quote = {
    id: "accepted-quote",
    status: "ACCEPTED",
    currency: "NGN",
    inputSnapshot: {
      source: "PLATFORM_OPERATIONAL_TARIFF",
      routeSnapshot: { legs: [{
        sequence: 1, type: "LOCAL_PICKUP",
        originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-1",
        originHubPointId: null, destinationHubPointId: "hub-1",
        origin: { latitude: 6.5244, longitude: 3.3792 },
        destination: { latitude: 6.525, longitude: 3.38 },
      }] },
      operationalTariffAssessment: { legs: [{
        sequence: 1, type: "LOCAL_PICKUP",
        packages: packages.map(pkg => ({
          packageId: pkg.id, packageSequence: pkg.packageSequence,
          packageCategory: pkg.packageCategory, weightGrams: pkg.weightGrams,
          dimensionsMm: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
        })),
      }] },
    },
  };
  const booking = {
    id: "booking-1", status: "IN_TRANSIT", paymentStatus: "SUCCEEDED",
    currency: "NGN", integrationClientId: null, integrationDispatchAuthorizedAt: null,
    parcelPackages: packages, quotes: [quote],
  };
  const leg = {
    id: "leg-2", parcelBookingId: booking.id, sequence: 2,
    type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
    originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-2",
    originHubPointId: "hub-1", destinationHubPointId: "hub-2",
    originLatitude: 6.5244, originLongitude: 3.3792,
    destinationLatitude: 7.1475, destinationLongitude: 3.3619,
    metadata: {
      source: "DRV-05C-D2_HUB_RECOVERY",
      sourceIntakeRecordId: "intake-1",
      sourceDeliveryLegId: "leg-1",
      hubRecoveryId: "recovery-1",
      executionSnapshotId: "snapshot-1",
    },
    parcelBooking: booking,
  };
  const disposition = {
    id: "disposition-1", intakeRecordId: "intake-1", hubRecoveryId: "recovery-1",
    parcelBookingId: booking.id, sourceDeliveryLegId: "leg-1", hubPointId: "hub-1",
    decision: "CONTINUE_DELIVERY", status: "ROUTE_APPROVED",
    destinationServiceZoneId: "zone-2", destinationHubPointId: "hub-2",
    nextDeliveryLegId: leg.id,
    intakeRecord: {
      id: "intake-1", status: "RECEIVED", parcelBookingId: booking.id,
      deliveryLegId: "leg-1", hubPointId: "hub-1",
    },
    hubRecovery: {
      id: "recovery-1", status: "CONFIRMED", parcelBookingId: booking.id,
      deliveryLegId: "leg-1", hubPointId: "hub-1", hubIntakeRecordId: "intake-1",
    },
    sourceDeliveryLeg: {
      id: "leg-1", parcelBookingId: booking.id, sequence: 1,
      status: "FAILED", failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED",
    },
    hubPoint: { id: "hub-1", serviceZoneId: "zone-1", latitude: 6.5244, longitude: 3.3792 },
    destinationHubPoint: { id: "hub-2", serviceZoneId: "zone-2", latitude: 7.1475, longitude: 3.3619 },
  };
  const partnerRate = {
    id: "partner-rate-1", rateCardId: "rate-card-1",
    originServiceZoneId: "zone-1", destinationServiceZoneId: "zone-2",
    serviceType: "PARCEL_DELIVERY", parcelCategory: "GENERAL",
    minWeightGrams: 0, maxWeightGrams: 1000,
    maxLengthMm: null, maxWidthMm: null, maxHeightMm: null,
    transportChargeMinor: 21000n, estimatedTransitMinutes: 180,
    rateCard: {
      id: "rate-card-1", version: 3, agreementId: "agreement-1",
      agreement: {
        id: "agreement-1", reference: "RECOVERY-AGR-001",
        partner: { id: "partner-1", displayName: "Recovery Partner" },
      },
    },
  };
  const snapshot = {
    id: "snapshot-1", deliveryLegId: leg.id, executorType: "TRANSPORT_PARTNER",
    selectedPartnerId: "partner-1", partnerAgreementId: "agreement-1",
    partnerRateCardId: "rate-card-1", costSourceVersion: 3,
    executionCostMinor: 21000n, currency: "NGN",
  };
  const hub = (id, serviceZoneId, latitude, longitude) => ({
    id, status: "ACTIVE", operatorVerificationStatus: "VERIFIED",
    serviceZoneId, acceptedParcelTypes: ["GENERAL"], capacityConfig: { maxParcels: 10 },
    serviceZone: {
      id: serviceZoneId, isActive: true,
      state: { isActive: true, country: { isActive: true } },
      availability: [{ id: `availability-${id}` }],
    },
    latitude, longitude,
  });
  let createdAssignment = null;
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => { createdAssignment = { id: "assignment-1", ...data }; return createdAssignment; },
    },
    deliveryLeg: {
      findUnique: async () => leg,
      findFirst: async () => ({
        id: "leg-1", sequence: 1, status: "FAILED", completedAt: null,
        failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED",
      }),
      updateMany: async () => { leg.status = "ASSIGNED"; return { count: 1 }; },
    },
    shipmentQuote: { findFirst: async () => quote },
    deliveryLegExecutionSnapshot: { findUnique: async () => snapshot },
    hubIntakeDisposition: { findUnique: async () => disposition },
    hubPoint: {
      findUnique: async ({ where }) => where.id === "hub-1"
        ? hub("hub-1", "zone-1", 6.5244, 3.3792)
        : hub("hub-2", "zone-2", 7.1475, 3.3619),
    },
    serviceZone: { findMany: async ({ where }) => where.id.in.map(id => ({ id })) },
    hubIntakeRecord: { findMany: async () => [] },
    partnerRate: { findMany: async () => [partnerRate] },
    partnerAgreement: {
      findUnique: async () => ({
        id: "agreement-1", partnerId: "partner-1", status: "ACTIVE",
        currency: "NGN", effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
        effectiveUntil: null,
        partner: { id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" },
      }),
    },
    operationalAuditEvent: { create: async () => ({ id: "audit-1" }) },
  };
  const prismaClient = { $transaction: async callback => callback(tx) };
  const service = createPartnerExecutionService({ prismaClient, clock: () => now });

  const result = await service.assignLeg({
    deliveryLegId: leg.id,
    partnerId: "partner-1",
    idempotencyKey: "recovery-partner-assignment-001",
    actorUserId: "admin-1",
  });

  assert.equal(result.replay, false);
  assert.equal(createdAssignment.partnerId, "partner-1");
  assert.equal(createdAssignment.agreedTransportChargeMinor, 21000n);
  assert.equal(createdAssignment.currency, "NGN");
  assert.equal(createdAssignment.metadata.executionSource, "DRV-05C-D2_HUB_RECOVERY");
  assert.equal(createdAssignment.metadata.executionSnapshotId, "snapshot-1");
  assert.equal(leg.status, "ASSIGNED");
});

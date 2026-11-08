import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";
import { env } from "../../config/env.js";

const CAPABILITIES = ["LOCAL_DISPATCH", "PICKUP_COLLECTION", "FINAL_MILE_DELIVERY"];
const REQUESTABLE_AGAIN = ["REJECTED", "REVOKED"];
const REVIEW_TRANSITIONS = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED", "REVOKED"],
  SUSPENDED: ["APPROVED", "REVOKED"],
  REJECTED: [],
  REVOKED: [],
};

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}
function assertCapability(capability) {
  if (!CAPABILITIES.includes(capability)) throw new TypeError("Unsupported driver service capability.");
}
function assertTransition(currentStatus, nextStatus) {
  if (!REVIEW_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
    throw conflict("CAPABILITY_INVALID_TRANSITION", `A capability cannot move from ${currentStatus} to ${nextStatus}.`);
  }
}

export function createDriverCapabilitiesService({ prismaClient, clock = () => new Date(), kycMode = env.DRIVER_KYC_MODE }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function requestRecord({ tx, delegate, uniqueWhere, createData, entityType, entityLabel, auditEntityId, actorUserId }) {
    const existing = await delegate.findUnique({ where: uniqueWhere });
    let record;
    let before = null;
    if (!existing) {
      record = await delegate.create({ data: createData });
    } else {
      if (!REQUESTABLE_AGAIN.includes(existing.status)) {
        throw conflict("CAPABILITY_REQUEST_EXISTS", `This ${entityLabel} capability is already ${existing.status.toLowerCase()}.`);
      }
      before = { status: existing.status, reviewReason: existing.reviewReason };
      const changed = await delegate.updateMany({
        where: { id: existing.id, status: { in: REQUESTABLE_AGAIN } },
        data: { status: "REQUESTED", requestedAt: clock(), reviewedAt: null, reviewReason: null },
      });
      if (changed.count !== 1) throw conflict("CAPABILITY_REQUEST_CONFLICT", "The capability changed while the request was being submitted.");
      record = await delegate.findUnique({ where: { id: existing.id } });
    }
    await writeOperationalAuditEvent(tx, {
      actorUserId,
      entityType,
      entityId: auditEntityId,
      action: before ? "CAPABILITY_REREQUESTED" : "CAPABILITY_REQUESTED",
      metadata: { capabilityRecordId: record.id, capability: record.capability, targetType: entityLabel },
      reason: "Driver requested an operational service capability.",
      before,
      after: { capability: record.capability, status: record.status },
    });
    return record;
  }

  async function reviewRecord({ tx, delegate, uniqueWhere, status, reason, actorUserId, entityType, entityLabel, eligibility }) {
    const current = await delegate.findUnique({ where: uniqueWhere });
    if (!current) return null;
    assertTransition(current.status, status);
    if (status === "APPROVED") {
      const eligible = await eligibility(current);
      if (!eligible.ok) throw conflict(eligible.code, eligible.message);
    }
    const now = clock();
    const changed = await delegate.updateMany({
      where: { id: current.id, status: current.status },
      data: { status, reviewedAt: now, reviewReason: reason },
    });
    if (changed.count !== 1) throw conflict("CAPABILITY_REVIEW_CONFLICT", "The capability changed while the review was being saved.");
    const updated = await delegate.findUnique({ where: { id: current.id } });
    const auditEntityId = entityLabel === "driver"
      ? current.driverProfileId
      : (await tx.vehicle.findUnique({ where: { id: current.vehicleId }, select: { driverProfileId: true } }))?.driverProfileId;
    if (!auditEntityId) throw conflict("CAPABILITY_OWNER_NOT_FOUND", "The driver associated with this capability could not be found.");
    await writeOperationalAuditEvent(tx, {
      actorUserId,
      entityType,
      entityId: auditEntityId,
      action: `CAPABILITY_${status}`,
      metadata: { capabilityRecordId: current.id, capability: current.capability, targetType: entityLabel },
      reason,
      before: { capability: current.capability, status: current.status, reviewReason: current.reviewReason },
      after: { capability: updated.capability, status: updated.status, reviewReason: updated.reviewReason },
    });
    return updated;
  }

  return {
    async listMyDriverCapabilities(userId) {
      const profile = await prismaClient.driverProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!profile) return null;
      return prismaClient.driverCapabilityGrant.findMany({
        where: { driverProfileId: profile.id },
        orderBy: { capability: "asc" },
        select: { id: true, capability: true, status: true, requestedAt: true, reviewedAt: true, reviewReason: true },
      });
    },

    async requestDriverCapability({ userId, capability }) {
      assertCapability(capability);
      return prismaClient.$transaction(async tx => {
        const profile = await tx.driverProfile.findUnique({ where: { userId }, select: { id: true } });
        if (!profile) return null;
        return requestRecord({
          tx,
          delegate: tx.driverCapabilityGrant,
          uniqueWhere: { driverProfileId_capability: { driverProfileId: profile.id, capability } },
          createData: { driverProfileId: profile.id, capability, status: "REQUESTED" },
          entityType: "DRIVER_PROFILE",
          entityLabel: "driver",
          auditEntityId: profile.id,
          actorUserId: userId,
        });
      });
    },

    async listMyVehicleCapabilities({ userId, vehicleId }) {
      const vehicle = await prismaClient.vehicle.findFirst({
        where: { id: vehicleId, driverProfile: { userId } },
        select: { id: true },
      });
      if (!vehicle) return null;
      return prismaClient.vehicleServiceCapability.findMany({
        where: { vehicleId },
        orderBy: { capability: "asc" },
        select: { id: true, capability: true, status: true, requestedAt: true, reviewedAt: true, reviewReason: true },
      });
    },

    async requestVehicleCapability({ userId, vehicleId, capability }) {
      assertCapability(capability);
      return prismaClient.$transaction(async tx => {
        const vehicle = await tx.vehicle.findFirst({
          where: { id: vehicleId, driverProfile: { userId } },
          select: { id: true, driverProfileId: true },
        });
        if (!vehicle) return null;
        return requestRecord({
          tx,
          delegate: tx.vehicleServiceCapability,
          uniqueWhere: { vehicleId_capability: { vehicleId, capability } },
          createData: { vehicleId, capability, status: "REQUESTED" },
          entityType: "DRIVER_PROFILE",
          entityLabel: "vehicle",
          auditEntityId: vehicle.driverProfileId,
          actorUserId: userId,
        });
      });
    },

    async listDriverCapabilities(driverProfileId) {
      const profile = await prismaClient.driverProfile.findUnique({ where: { id: driverProfileId }, select: { id: true } });
      if (!profile) return null;
      return prismaClient.driverCapabilityGrant.findMany({
        where: { driverProfileId },
        orderBy: { capability: "asc" },
        select: { id: true, capability: true, status: true, requestedAt: true, reviewedAt: true, reviewReason: true },
      });
    },

    async reviewDriverCapability({ driverProfileId, capability, status, reason, actorUserId }) {
      assertCapability(capability);
      return prismaClient.$transaction(tx => reviewRecord({
        tx,
        delegate: tx.driverCapabilityGrant,
        uniqueWhere: { driverProfileId_capability: { driverProfileId, capability } },
        status,
        reason,
        actorUserId,
        entityType: "DRIVER_PROFILE",
        entityLabel: "driver",
        eligibility: async current => {
          const profile = await tx.driverProfile.findUnique({
            where: { id: current.driverProfileId },
            select: { verificationStatus: true, suspendedAt: true, kycTier: true },
          });
          if (!profile || profile.verificationStatus !== "VERIFIED" || profile.suspendedAt) {
            return { ok: false, code: "DRIVER_PROFILE_NOT_APPROVED", message: "A driver capability can only be approved for a verified, active driver profile." };
          }
          const kycAllowed = profile.kycTier === "FULL"
            || (kycMode === "TEST" && profile.kycTier === "TEST_LIMITED" && capability === "LOCAL_DISPATCH");
          if (!kycAllowed) {
            return { ok: false, code: "DRIVER_KYC_CAPABILITY_RESTRICTED", message: "This driver's KYC tier does not permit approval for the requested service capability." };
          }
          return { ok: true };
        },
      }));
    },

    async listVehicleCapabilities(vehicleId) {
      const vehicle = await prismaClient.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
      if (!vehicle) return null;
      return prismaClient.vehicleServiceCapability.findMany({
        where: { vehicleId },
        orderBy: { capability: "asc" },
        select: { id: true, capability: true, status: true, requestedAt: true, reviewedAt: true, reviewReason: true },
      });
    },

    async reviewVehicleCapability({ vehicleId, capability, status, reason, actorUserId }) {
      assertCapability(capability);
      return prismaClient.$transaction(tx => reviewRecord({
        tx,
        delegate: tx.vehicleServiceCapability,
        uniqueWhere: { vehicleId_capability: { vehicleId, capability } },
        status,
        reason,
        actorUserId,
        entityType: "DRIVER_PROFILE",
        entityLabel: "vehicle",
        eligibility: async current => {
          const vehicle = await tx.vehicle.findUnique({
            where: { id: current.vehicleId },
            select: {
              isActive: true,
              verificationStatus: true,
              driverProfile: { select: { verificationStatus: true, suspendedAt: true, kycTier: true } },
            },
          });
          if (!vehicle || !vehicle.isActive || vehicle.verificationStatus !== "VERIFIED") {
            return { ok: false, code: "VEHICLE_NOT_APPROVED", message: "Vehicle suitability can only be approved for a verified, active vehicle." };
          }
          if (vehicle.driverProfile.verificationStatus !== "VERIFIED" || vehicle.driverProfile.suspendedAt) {
            return { ok: false, code: "DRIVER_PROFILE_NOT_APPROVED", message: "Vehicle suitability requires a verified, active driver profile." };
          }
          const kycAllowed = vehicle.driverProfile.kycTier === "FULL"
            || (kycMode === "TEST" && vehicle.driverProfile.kycTier === "TEST_LIMITED" && capability === "LOCAL_DISPATCH");
          if (!kycAllowed) {
            return { ok: false, code: "DRIVER_KYC_CAPABILITY_RESTRICTED", message: "This driver's KYC tier does not permit approval for the requested vehicle service capability." };
          }
          return { ok: true };
        },
      }));
    },
  };
}

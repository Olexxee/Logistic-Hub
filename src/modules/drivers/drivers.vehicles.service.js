import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

const ACTIVE_ASSIGNMENT_STATUSES = ["AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"];

function normalizePlate(value) {
  return value == null ? null : value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function createDriverVehiclesService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function ownProfile(tx, userId) {
    const profile = await tx.driverProfile.findUnique({
      where: { userId },
      select: { id: true, suspendedAt: true },
    });
    if (!profile) throw new NotFoundError("Driver profile not found. Complete onboarding first.");
    if (profile.suspendedAt) throw new ForbiddenError("A suspended driver cannot register or change vehicles.");
    return profile;
  }

  return {
    async listMine({ userId }) {
      const profile = await prismaClient.driverProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!profile) throw new NotFoundError("Driver profile not found. Complete onboarding first.");
      return prismaClient.vehicle.findMany({
        where: { driverProfileId: profile.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, type: true, make: true, model: true, registrationPlate: true,
          parcelCapacity: true, verificationStatus: true, isActive: true, createdAt: true, updatedAt: true,
          serviceCapabilities: { select: { capability: true, status: true, reviewedAt: true, reviewReason: true }, orderBy: { capability: "asc" } },
        },
      });
    },

    async addVehicle({ userId, input }) {
      return prismaClient.$transaction(async tx => {
        const profile = await ownProfile(tx, userId);
        const registrationPlate = normalizePlate(input.registrationPlate);
        try {
          const vehicle = await tx.vehicle.create({
            data: {
              driverProfileId: profile.id,
              type: input.type,
              make: input.make,
              model: input.model,
              registrationPlate,
              parcelCapacity: input.parcelCapacity,
              verificationStatus: "PENDING",
              isActive: false,
            },
            select: {
              id: true, driverProfileId: true, type: true, make: true, model: true,
              registrationPlate: true, parcelCapacity: true, verificationStatus: true, isActive: true, createdAt: true,
            },
          });
          await writeOperationalAuditEvent(tx, {
            actorUserId: userId, entityType: "VEHICLE", entityId: vehicle.id,
            action: "DRIVER_VEHICLE_REGISTERED",
            after: { type: vehicle.type, make: vehicle.make, model: vehicle.model, registrationPlate: vehicle.registrationPlate, verificationStatus: vehicle.verificationStatus, isActive: vehicle.isActive },
            metadata: { driverProfileId: profile.id },
          });
          return vehicle;
        } catch (error) {
          if (error?.code === "P2002") throw new ConflictError("This vehicle registration plate is already registered.", "VEHICLE_REGISTRATION_EXISTS");
          throw error;
        }
      });
    },

    async updateVehicle({ userId, vehicleId, input }) {
      return prismaClient.$transaction(async tx => {
        const profile = await ownProfile(tx, userId);
        const current = await tx.vehicle.findFirst({
          where: { id: vehicleId, driverProfileId: profile.id },
          select: { id: true, type: true, make: true, model: true, registrationPlate: true, parcelCapacity: true, verificationStatus: true, isActive: true },
        });
        if (!current) throw new NotFoundError("Vehicle not found.");
        if (current.verificationStatus === "VERIFIED") {
          throw new ConflictError("A verified vehicle's identity and specifications cannot be edited. Register a replacement vehicle instead.", "VERIFIED_VEHICLE_IMMUTABLE");
        }
        const identityChanged = ["type", "make", "model", "registrationPlate"].some(field =>
          input[field] !== undefined && (field === "registrationPlate"
            ? normalizePlate(input[field]) !== current.registrationPlate
            : input[field] !== current[field])
        );
        if (identityChanged) {
          const existingEvidence = await tx.driverVerificationDocument.findFirst({
            where: { vehicleId, reviewStatus: { in: ["PENDING", "APPROVED"] } },
            select: { id: true },
          });
          if (existingEvidence) {
            throw new ConflictError("Vehicle identity cannot be changed while verification evidence is attached. Register a replacement vehicle so the evidence remains bound to the correct vehicle.", "VEHICLE_EVIDENCE_EXISTS");
          }
        }
        const data = {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.make !== undefined ? { make: input.make } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.registrationPlate !== undefined ? { registrationPlate: normalizePlate(input.registrationPlate) } : {}),
          ...(input.parcelCapacity !== undefined ? { parcelCapacity: input.parcelCapacity } : {}),
          verificationStatus: "PENDING",
          isActive: false,
        };
        try {
          const updated = await tx.vehicle.update({
            where: { id: vehicleId },
            data,
            select: { id: true, driverProfileId: true, type: true, make: true, model: true, registrationPlate: true, parcelCapacity: true, verificationStatus: true, isActive: true, updatedAt: true },
          });
          await writeOperationalAuditEvent(tx, {
            actorUserId: userId, entityType: "VEHICLE", entityId: vehicleId,
            action: "DRIVER_VEHICLE_UPDATED",
            before: { type: current.type, make: current.make, model: current.model, registrationPlate: current.registrationPlate, parcelCapacity: current.parcelCapacity, verificationStatus: current.verificationStatus, isActive: current.isActive },
            after: { type: updated.type, make: updated.make, model: updated.model, registrationPlate: updated.registrationPlate, parcelCapacity: updated.parcelCapacity, verificationStatus: updated.verificationStatus, isActive: updated.isActive },
            metadata: { driverProfileId: profile.id },
          });
          return updated;
        } catch (error) {
          if (error?.code === "P2002") throw new ConflictError("This vehicle registration plate is already registered.", "VEHICLE_REGISTRATION_EXISTS");
          throw error;
        }
      });
    },

    async deactivateVehicle({ userId, vehicleId }) {
      return prismaClient.$transaction(async tx => {
        const profile = await ownProfile(tx, userId);
        const current = await tx.vehicle.findFirst({
          where: { id: vehicleId, driverProfileId: profile.id },
          select: { id: true, isActive: true, verificationStatus: true, type: true, registrationPlate: true },
        });
        if (!current) throw new NotFoundError("Vehicle not found.");
        if (!current.isActive) return { id: current.id, isActive: false, alreadyInactive: true };
        const activeAssignment = await tx.driverAssignment.findFirst({
          where: {
            driverProfileId: profile.id,
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            OR: [
              { vehicleId },
              { vehicleId: null, parcelBookingId: { not: null } },
            ],
          },
          select: { id: true },
        });
        if (activeAssignment) {
          throw new ConflictError("This vehicle is assigned to an active delivery and cannot be deactivated until that assignment is closed.", "VEHICLE_HAS_ACTIVE_ASSIGNMENT");
        }
        const updated = await tx.vehicle.update({
          where: { id: vehicleId },
          data: { isActive: false },
          select: { id: true, isActive: true },
        });
        const anotherEligibleVehicle = await tx.vehicle.findFirst({
          where: { driverProfileId: profile.id, id: { not: vehicleId }, isActive: true, verificationStatus: "VERIFIED" },
          select: { id: true },
        });
        if (!anotherEligibleVehicle) {
          await tx.driverProfile.update({
            where: { id: profile.id },
            data: { isOnline: false, isAvailable: false },
          });
        }
        await writeOperationalAuditEvent(tx, {
          actorUserId: userId, entityType: "VEHICLE", entityId: vehicleId,
          action: "DRIVER_VEHICLE_DEACTIVATED",
          before: { isActive: current.isActive },
          after: { isActive: updated.isActive },
          metadata: { driverProfileId: profile.id, driverForcedOffline: !anotherEligibleVehicle },
        });
        return { ...updated, driverForcedOffline: !anotherEligibleVehicle };
      });
    },
  };
}

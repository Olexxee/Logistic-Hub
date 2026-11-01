import { createDriversAdminRepository } from "./drivers.admin.repository.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

export function createDriversAdminService({ prismaClient }) {
  const repository = createDriversAdminRepository({ prismaClient });
  return {
    listDrivers: input => repository.listDrivers(input),
    listVehicles: input => repository.listVehicles(input),
    listDriverAudit: input => repository.listDriverAudit(input),
    async setDriverStatus({ driverProfileId, status, reason, actorUserId }) {
      return prismaClient.$transaction(async tx => {
        const current = await tx.driverProfile.findUnique({
          where: { id: driverProfileId },
          select: { id: true, suspendedAt: true, suspensionReason: true, reinstatedAt: true, isOnline: true, isAvailable: true },
        });
        if (!current) return null;
        if (status === "SUSPENDED" && current.suspendedAt) {
          const error = new Error("Driver is already suspended.");
          error.statusCode = 409;
          error.code = "DRIVER_ALREADY_SUSPENDED";
          throw error;
        }
        if (status === "ACTIVE" && !current.suspendedAt) {
          const error = new Error("Driver is not suspended.");
          error.statusCode = 409;
          error.code = "DRIVER_NOT_SUSPENDED";
          throw error;
        }
        const now = new Date();
        const updated = await tx.driverProfile.update({
          where: { id: driverProfileId },
          data: status === "SUSPENDED"
            ? { suspendedAt: now, suspensionReason: reason, isOnline: false, isAvailable: false }
            : { suspendedAt: null, suspensionReason: null, reinstatedAt: now, isOnline: false, isAvailable: false },
          select: { id: true, suspendedAt: true, suspensionReason: true, reinstatedAt: true, isOnline: true, isAvailable: true },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId,
          entityType: "DRIVER_PROFILE",
          entityId: driverProfileId,
          action: status === "SUSPENDED" ? "DRIVER_SUSPENDED" : "DRIVER_REINSTATED",
          reason,
          before: { suspendedAt: current.suspendedAt, suspensionReason: current.suspensionReason, reinstatedAt: current.reinstatedAt, isOnline: current.isOnline, isAvailable: current.isAvailable },
          after: { suspendedAt: updated.suspendedAt, suspensionReason: updated.suspensionReason, reinstatedAt: updated.reinstatedAt, isOnline: updated.isOnline, isAvailable: updated.isAvailable },
        });
        return updated;
      });
    },
  };
}

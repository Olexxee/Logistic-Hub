export function createDriversAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    async listDrivers({ verificationStatus, kycTier, page, limit }) {
      const where = { ...(verificationStatus ? { verificationStatus } : {}), ...(kycTier ? { kycTier } : {}) };
      const [items, total] = await Promise.all([
        prismaClient.driverProfile.findMany({
          where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * limit, take: limit,
          select: {
            id: true, verificationStatus: true, kycTier: true, suspendedAt: true, suspensionReason: true, reinstatedAt: true, isOnline: true, isAvailable: true,
            serviceRadiusMeters: true, averageRating: true, completedJobs: true,
            cancelledJobs: true, lastLocationAt: true, createdAt: true, updatedAt: true,
            user: { select: { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true } },
            vehicles: { select: { id: true, type: true, make: true, model: true, registrationPlate: true, verificationStatus: true, isActive: true } },
            coverage: { select: { id: true, serviceZoneId: true, serviceType: true, isEnabled: true, serviceZone: { select: { code: true, name: true, isActive: true } } } },
          },
        }),
        prismaClient.driverProfile.count({ where }),
      ]);
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },
    async listDriverAudit({ driverProfileId, page, limit }) {
      const where = { entityType: "DRIVER_PROFILE", entityId: driverProfileId };
      const [items, total] = await Promise.all([
        prismaClient.operationalAuditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit, select: { id: true, actorUserId: true, action: true, reason: true, before: true, after: true, metadata: true, createdAt: true, actor: { select: { id: true, fullName: true, email: true } } } }),
        prismaClient.operationalAuditEvent.count({ where }),
      ]);
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },
    async listVehicles({ verificationStatus, isActive, page, limit }) {
      const where = { ...(verificationStatus ? { verificationStatus } : {}), ...(isActive === undefined ? {} : { isActive }) };
      const [items, total] = await Promise.all([
        prismaClient.vehicle.findMany({
          where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * limit, take: limit,
          select: {
            id: true, driverProfileId: true, type: true, make: true, model: true,
            registrationPlate: true, verificationStatus: true, isActive: true,
            parcelCapacity: true, createdAt: true, updatedAt: true,
            driverProfile: { select: { id: true, verificationStatus: true, user: { select: { id: true, fullName: true, email: true, phone: true } } } },
          },
        }),
        prismaClient.vehicle.count({ where }),
      ]);
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },
  };
}

function forbidden(message = "You do not have permission to perform this action.") {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = "FORBIDDEN";
  return error;
}

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

export function createDriversService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async getMyProfile(userId) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        include: {
          vehicles: true,
          coverage: {
            include: { serviceZone: { select: { id: true, code: true, name: true, isActive: true } } },
          },
        },
      });
      if (!profile) return null;
      return {
        id: profile.id,
        verificationStatus: profile.verificationStatus,
        isOnline: profile.isOnline,
        isAvailable: profile.isAvailable,
        serviceRadiusMeters: profile.serviceRadiusMeters,
        averageRating: profile.averageRating == null ? null : profile.averageRating.toString(),
        completedJobs: profile.completedJobs,
        cancelledJobs: profile.cancelledJobs,
        lastLocationAt: profile.lastLocationAt,
        vehicles: profile.vehicles.map((vehicle) => ({
          id: vehicle.id,
          type: vehicle.type,
          make: vehicle.make,
          model: vehicle.model,
          registrationPlate: vehicle.registrationPlate,
          verificationStatus: vehicle.verificationStatus,
          isActive: vehicle.isActive,
          parcelCapacity: vehicle.parcelCapacity,
        })),
        coverage: profile.coverage.map((item) => ({
          id: item.id,
          serviceType: item.serviceType,
          isEnabled: item.isEnabled,
          serviceZone: item.serviceZone,
        })),
      };
    },

    async submitOnboarding({ user, input }) {
      const existing = await prismaClient.driverProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (existing) throw conflict("DRIVER_PROFILE_EXISTS", "A driver onboarding profile already exists for this account.");
      try {
        const profile = await prismaClient.$transaction(async (tx) => {
          const created = await tx.driverProfile.create({
            data: {
              userId: user.id,
              verificationStatus: "PENDING",
              isOnline: false,
              isAvailable: false,
              serviceRadiusMeters: input.serviceRadiusMeters,
            },
          });
          await tx.vehicle.create({
            data: {
              driverProfileId: created.id,
              type: input.vehicle.type,
              make: input.vehicle.make,
              model: input.vehicle.model,
              registrationPlate: input.vehicle.registrationPlate,
              parcelCapacity: input.vehicle.parcelCapacity,
              verificationStatus: "PENDING",
              isActive: false,
            },
          });
          return created;
        });
        return { id: profile.id, verificationStatus: profile.verificationStatus, isOnline: false, isAvailable: false };
      } catch (error) {
        if (error.code === "P2002") throw conflict("DRIVER_PROFILE_EXISTS", "The driver profile or vehicle registration already exists.");
        throw error;
      }
    },

    async setAvailability({ userId, input }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        include: {
          vehicles: true,
          coverage: {
            where: { isEnabled: true },
            include: {
              serviceZone: {
                include: {
                  state: { include: { country: true } },
                  availability: true,
                },
              },
            },
          },
        },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED") {
        throw forbidden("Driver verification must be completed before going online.");
      }
      if (input.isAvailable) {
        const now = clock();
        const hasActiveVehicle = profile.vehicles.some((vehicle) => vehicle.isActive && vehicle.verificationStatus === "VERIFIED");
        const hasEligibleCoverage = profile.coverage.some((coverage) => {
          const zone = coverage.serviceZone;
          if (!zone?.isActive || !zone.state?.isActive || !zone.state.country?.isActive) return false;
          return zone.availability.some((availability) =>
            availability.serviceType === coverage.serviceType &&
            availability.isEnabled &&
            (!availability.startsAt || availability.startsAt <= now) &&
            (!availability.endsAt || availability.endsAt >= now)
          );
        });
        if (!hasActiveVehicle || !hasEligibleCoverage) {
          throw conflict("DRIVER_NOT_READY", "At least one verified active vehicle and enabled coverage in an active service zone are required.");
        }
      }
      const updated = await prismaClient.driverProfile.update({
        where: { id: profile.id },
        data: { isOnline: input.isOnline, isAvailable: input.isOnline && input.isAvailable },
        select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true },
      });
      return updated;
    },

    async recordLocation({ userId, input }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true, isOnline: true },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isOnline) {
        throw forbidden("Only a verified online driver can publish a location.");
      }
      const recordedAt = clock();
      const location = await prismaClient.$transaction(async (tx) => {
        const created = await tx.driverLocation.create({
          data: {
            driverProfileId: profile.id,
            latitude: input.latitude,
            longitude: input.longitude,
            accuracyMeters: input.accuracyMeters,
            recordedAt,
          },
          select: { id: true, latitude: true, longitude: true, accuracyMeters: true, recordedAt: true },
        });
        await tx.driverProfile.update({ where: { id: profile.id }, data: { lastLocationAt: recordedAt } });
        return created;
      });
      return {
        id: location.id,
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString(),
        accuracyMeters: location.accuracyMeters?.toString() ?? null,
        recordedAt: location.recordedAt,
      };
    },

    async reviewDriver({ driverProfileId, verificationStatus }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { id: driverProfileId },
        select: { id: true, userId: true },
      });
      if (!profile) return null;
      return prismaClient.$transaction(async (tx) => {
        const updated = await tx.driverProfile.update({
          where: { id: profile.id },
          data: {
            verificationStatus,
            isOnline: false,
            isAvailable: false,
          },
          select: { id: true, verificationStatus: true, isOnline: true, isAvailable: true, userId: true },
        });
        await tx.user.update({
          where: { id: profile.userId },
          data: { role: verificationStatus === "VERIFIED" ? "DRIVER" : "CUSTOMER" },
        });
        return {
          id: updated.id,
          verificationStatus: updated.verificationStatus,
          isOnline: updated.isOnline,
          isAvailable: updated.isAvailable,
          userId: updated.userId,
        };
      });
    },

    async reviewVehicle({ vehicleId, verificationStatus }) {
      const vehicle = await prismaClient.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
      if (!vehicle) return null;
      return prismaClient.vehicle.update({
        where: { id: vehicle.id },
        data: {
          verificationStatus,
          isActive: verificationStatus === "VERIFIED",
        },
        select: { id: true, verificationStatus: true, isActive: true },
      });
    },

    async setCoverage(input) {
      const zone = await prismaClient.serviceZone.findUnique({ where: { id: input.serviceZoneId }, include: { state: { include: { country: true } }, availability: { where: { serviceType: input.serviceType, isEnabled: true } } } });
      if (!zone) return null;
      if (!zone.isActive || !zone.state?.isActive || !zone.state.country?.isActive || zone.availability.length === 0) throw conflict("SERVICE_ZONE_NOT_ELIGIBLE", "Coverage requires an active zone, state, country, and matching service availability.");
      const profile = await prismaClient.driverProfile.findUnique({ where: { id: input.driverProfileId }, select: { id: true } });
      if (!profile) return null;
      return prismaClient.driverCoverage.upsert({
        where: {
          driverProfileId_serviceZoneId_serviceType: {
            driverProfileId: input.driverProfileId,
            serviceZoneId: input.serviceZoneId,
            serviceType: input.serviceType,
          },
        },
        create: input,
        update: { isEnabled: input.isEnabled },
        select: { id: true, driverProfileId: true, serviceZoneId: true, serviceType: true, isEnabled: true },
      });
    },
  };
}

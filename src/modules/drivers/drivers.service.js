import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";
import { env } from "../../config/env.js";

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

export function createDriversService({ prismaClient, clock = () => new Date(), kycMode = env.DRIVER_KYC_MODE }) {
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
        kycTier: profile.kycTier,
        kycMode: kycMode,
        suspendedAt: profile.suspendedAt,
        suspensionReason: profile.suspensionReason,
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
      if (!profile || profile.verificationStatus !== "VERIFIED" || profile.suspendedAt || !(profile.kycTier === "FULL" || (kycMode === "TEST" && profile.kycTier === "TEST_LIMITED"))) {
        throw forbidden(profile?.suspendedAt ? "This driver account is suspended. Contact operations before attempting to go online." : "Driver verification must be completed before going online.");
      }
      if (input.isAvailable) {
        const now = clock();
        const hasActiveVehicle = profile.vehicles.some((vehicle) => vehicle.isActive && vehicle.verificationStatus === "VERIFIED");
        const hasEligibleCoverage = profile.coverage.some((coverage) => {
          if (profile.kycTier === "TEST_LIMITED" && coverage.serviceType !== "PARCEL_DELIVERY") return false;
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
        select: { id: true, verificationStatus: true, kycTier: true, isOnline: true, isAvailable: true },
      });
      return updated;
    },

    async recordLocation({ userId, input }) {
      const profile = await prismaClient.driverProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true, isOnline: true },
      });
      if (!profile || profile.verificationStatus !== "VERIFIED" || profile.suspendedAt || !profile.isOnline || !(profile.kycTier === "FULL" || (kycMode === "TEST" && profile.kycTier === "TEST_LIMITED"))) {
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

    async reapply({ userId, reason }) {
      return prismaClient.$transaction(async tx => {
        const profile = await tx.driverProfile.findUnique({
          where: { userId },
          select: { id: true, verificationStatus: true, kycTier: true, isOnline: true, isAvailable: true, updatedAt: true },
        });
        if (!profile) return null;
        if (profile.verificationStatus !== "REJECTED") throw conflict("DRIVER_NOT_REAPPLICABLE", "Only rejected driver applications can be resubmitted.");
        if (kycMode === "STRICT") {
          const updatedEvidence = await tx.driverVerificationDocument.findFirst({
            where: { driverProfileId: profile.id, reviewStatus: { in: ["PENDING", "APPROVED"] }, createdAt: { gt: profile.updatedAt } },
            select: { id: true },
          });
          if (!updatedEvidence) throw conflict("REAPPLICATION_EVIDENCE_REQUIRED", "Upload updated verification evidence before reapplying in strict mode.");
        }
        const updated = await tx.driverProfile.update({
          where: { id: profile.id },
          data: { verificationStatus: "PENDING", isOnline: false, isAvailable: false },
          select: { id: true, verificationStatus: true, kycTier: true, isOnline: true, isAvailable: true },
        });
        await tx.user.update({ where: { id: userId }, data: { role: "CUSTOMER" } });
        await writeOperationalAuditEvent(tx, {
          actorUserId: userId, entityType: "DRIVER_PROFILE", entityId: profile.id,
          action: "DRIVER_APPLICATION_RESUBMITTED", reason,
          before: { verificationStatus: profile.verificationStatus, isOnline: profile.isOnline, isAvailable: profile.isAvailable },
          after: { verificationStatus: updated.verificationStatus, isOnline: updated.isOnline, isAvailable: updated.isAvailable },
          metadata: { kycTier: updated.kycTier },
        });
        return updated;
      });
    },

    async reviewDriver({ driverProfileId, verificationStatus, reason, actorUserId }) {
      return prismaClient.$transaction(async (tx) => {
        const profile = await tx.driverProfile.findUnique({
          where: { id: driverProfileId },
          select: { id: true, userId: true, verificationStatus: true, kycTier: true, isOnline: true, isAvailable: true, suspendedAt: true },
        });
        if (!profile) return null;
        const isKycReassessment = profile.verificationStatus === "VERIFIED" && profile.kycTier === "UNASSESSED";
        if (!["PENDING", "REJECTED"].includes(profile.verificationStatus) && !isKycReassessment) {
          throw conflict("DRIVER_NOT_REVIEWABLE", "Only pending or previously rejected driver applications can be reviewed.");
        }

        const approved = verificationStatus === "VERIFIED";
        if (approved && kycMode === "STRICT") {
          const identityDocument = await tx.driverVerificationDocument.findFirst({ where: { driverProfileId: profile.id, vehicleId: null, documentType: "IDENTITY", reviewStatus: "APPROVED" }, select: { id: true } });
          if (!identityDocument) throw conflict("DRIVER_IDENTITY_DOCUMENT_REQUIRED", "An approved identity document is required before strict-mode driver verification.");
        }
        const nextKycTier = kycMode === "TEST" ? "TEST_LIMITED" : "FULL";
        const updated = await tx.driverProfile.update({
          where: { id: profile.id },
          data: {
            verificationStatus,
            ...(approved ? { kycTier: nextKycTier } : {}),
            isOnline: false,
            isAvailable: false,
          },
          select: { id: true, verificationStatus: true, kycTier: true, isOnline: true, isAvailable: true, userId: true },
        });
        if (approved && kycMode === "STRICT") {
          const verifiedVehicles = await tx.vehicle.findMany({
            where: { driverProfileId: profile.id, verificationStatus: "VERIFIED" },
            select: { id: true, type: true },
          });
          const [license, registrationDocuments] = await Promise.all([
            tx.driverVerificationDocument.findFirst({
              where: { driverProfileId: profile.id, vehicleId: null, documentType: "DRIVER_LICENSE", reviewStatus: "APPROVED" },
              select: { id: true },
            }),
            tx.driverVerificationDocument.findMany({
              where: { vehicleId: { in: verifiedVehicles.map(vehicle => vehicle.id) }, documentType: "VEHICLE_REGISTRATION", reviewStatus: "APPROVED" },
              select: { vehicleId: true },
            }),
          ]);
          const registeredVehicleIds = new Set(registrationDocuments.map(document => document.vehicleId));
          const eligibleVehicleIds = verifiedVehicles
            .filter(vehicle => vehicle.type === "BICYCLE" || (license && registeredVehicleIds.has(vehicle.id)))
            .map(vehicle => vehicle.id);
          const ineligibleVehicleIds = verifiedVehicles
            .filter(vehicle => !eligibleVehicleIds.includes(vehicle.id))
            .map(vehicle => vehicle.id);
          if (eligibleVehicleIds.length) {
            await tx.vehicle.updateMany({
              where: { id: { in: eligibleVehicleIds } },
              data: { isActive: !profile.suspendedAt },
            });
          }
          if (ineligibleVehicleIds.length) {
            await tx.vehicle.updateMany({
              where: { id: { in: ineligibleVehicleIds } },
              data: { isActive: false },
            });
          }
        } else {
          await tx.vehicle.updateMany({
            where: { driverProfileId: profile.id, verificationStatus: "VERIFIED" },
            data: { isActive: approved && !profile.suspendedAt },
          });
        }
        await tx.user.update({
          where: { id: profile.userId },
          data: { role: approved ? "DRIVER" : "CUSTOMER" },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId,
          entityType: "DRIVER_PROFILE",
          entityId: profile.id,
          action: isKycReassessment ? (approved ? "DRIVER_KYC_REASSESSED" : "DRIVER_KYC_REASSESSMENT_REJECTED") : (approved ? "DRIVER_VERIFICATION_APPROVED" : "DRIVER_VERIFICATION_REJECTED"),
          reason,
          before: {
            verificationStatus: profile.verificationStatus,
            kycTier: profile.kycTier,
            isOnline: profile.isOnline,
            isAvailable: profile.isAvailable,
          },
          after: {
            verificationStatus: updated.verificationStatus,
            kycTier: updated.kycTier,
            isOnline: updated.isOnline,
            isAvailable: updated.isAvailable,
          },
          metadata: { isKycReassessment },
        });
        return {
          id: updated.id,
          verificationStatus: updated.verificationStatus,
          kycTier: updated.kycTier,
          isOnline: updated.isOnline,
          isAvailable: updated.isAvailable,
          userId: updated.userId,
        };
      });
    },

    async reviewVehicle({ vehicleId, verificationStatus, reason, actorUserId }) {
      return prismaClient.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUnique({
          where: { id: vehicleId },
          select: {
            id: true,
            driverProfileId: true,
            verificationStatus: true,
            isActive: true,
            type: true,
            driverProfile: { select: { id: true, verificationStatus: true, kycTier: true, suspendedAt: true } },
          },
        });
        if (!vehicle) return null;
        if (!["PENDING", "REJECTED"].includes(vehicle.verificationStatus)) {
          throw conflict("VEHICLE_NOT_REVIEWABLE", "Only pending or previously rejected vehicles can be reviewed.");
        }
        const approved = verificationStatus === "VERIFIED";
        if (approved && kycMode === "STRICT" && vehicle.type !== "BICYCLE") {
          const [registration, license] = await Promise.all([
            tx.driverVerificationDocument.findFirst({ where: { vehicleId: vehicle.id, documentType: "VEHICLE_REGISTRATION", reviewStatus: "APPROVED" }, select: { id: true } }),
            tx.driverVerificationDocument.findFirst({ where: { driverProfileId: vehicle.driverProfile.id, vehicleId: null, documentType: "DRIVER_LICENSE", reviewStatus: "APPROVED" }, select: { id: true } }),
          ]);
          if (!registration || !license) throw conflict("VEHICLE_DOCUMENTS_REQUIRED", "Approved vehicle registration and driver-license documents are required in strict mode.");
        }
        const updated = await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            verificationStatus,
            isActive: approved && vehicle.driverProfile.verificationStatus === "VERIFIED" && !vehicle.driverProfile.suspendedAt && (vehicle.driverProfile.kycTier === "FULL" || (kycMode === "TEST" && vehicle.driverProfile.kycTier === "TEST_LIMITED")),
          },
          select: { id: true, verificationStatus: true, isActive: true, driverProfileId: true },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId,
          entityType: "VEHICLE",
          entityId: vehicle.id,
          action: approved ? "DRIVER_VEHICLE_VERIFICATION_APPROVED" : "DRIVER_VEHICLE_VERIFICATION_REJECTED",
          reason,
          before: { verificationStatus: vehicle.verificationStatus, isActive: vehicle.isActive },
          after: { verificationStatus: updated.verificationStatus, isActive: updated.isActive },
          metadata: { driverProfileId: vehicle.driverProfileId },
        });
        return { id: updated.id, verificationStatus: updated.verificationStatus, isActive: updated.isActive };
      });
    },

    async setCoverage(input) {
      const zone = await prismaClient.serviceZone.findUnique({ where: { id: input.serviceZoneId }, include: { state: { include: { country: true } }, availability: { where: { serviceType: input.serviceType, isEnabled: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: clock() } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: clock() } }] }] } } } });
      if (!zone) return null;
      if (input.isEnabled && (!zone.isActive || !zone.state?.isActive || !zone.state.country?.isActive || zone.availability.length === 0)) throw conflict("SERVICE_ZONE_NOT_ELIGIBLE", "Coverage requires an active zone, state, country, and matching service availability.");
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

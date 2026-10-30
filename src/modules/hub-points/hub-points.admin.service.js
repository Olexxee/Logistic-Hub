import { createHubPointsAdminRepository } from "./hub-points.admin.repository.js";
import { openingHoursAdminSchema, capacityConfigAdminSchema } from "./hub-points.admin.validators.js";

const PARCEL_SERVICE = "PARCEL_DELIVERY";
function conflict(code, message) { const error = new Error(message); error.statusCode = 409; error.code = code; return error; }
function hasOperationalDetails(hub) {
  return Boolean(
    hub.operatorName?.trim() &&
    hub.operatorPhone?.trim() &&
    hub.operatorVerificationStatus === "VERIFIED" &&
    Array.isArray(hub.acceptedParcelTypes) && hub.acceptedParcelTypes.length > 0 &&
    openingHoursAdminSchema.safeParse(hub.openingHours).success &&
    capacityConfigAdminSchema.safeParse(hub.capacityConfig).success
  );
}

export function createHubPointsAdminService({ prismaClient, clock = () => new Date() }) {
  const repository = createHubPointsAdminRepository({ prismaClient });
  return {
    list() { return repository.list(); },
    async create(input) {
      const zone = await prismaClient.serviceZone.findUnique({
        where: { id: input.serviceZoneId }, include: { state: { include: { country: true } } },
      });
      if (!zone) return null;
      if (!zone.isActive || !zone.state.isActive || !zone.state.country.isActive) {
        throw conflict("SERVICE_ZONE_INACTIVE", "A hub can only be registered in an active service zone.");
      }
      const { latitude, longitude, ...data } = input;
      return repository.create({ ...data, latitude, longitude, status: "PENDING" });
    },
    async update(id, input) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (current.status === "CLOSED") throw conflict("HUB_CLOSED", "Closed hubs cannot be edited.");
      if (current.status === "ACTIVE" && input.serviceZoneId) {
        throw conflict("ACTIVE_HUB_ZONE_IMMUTABLE", "Suspend a hub before changing its service zone.");
      }
      if (input.serviceZoneId) {
        const zone = await prismaClient.serviceZone.findUnique({
          where: { id: input.serviceZoneId }, include: { state: { include: { country: true } } },
        });
        if (!zone || !zone.isActive || !zone.state?.isActive || !zone.state.country?.isActive) {
          throw conflict("SERVICE_ZONE_INACTIVE", "The selected service zone and its parent geography must be active.");
        }
      }
      const next = { ...current, ...input };
      if (current.status === "ACTIVE" && !hasOperationalDetails(next)) {
        throw conflict("HUB_OPERATIONAL_DETAILS_REQUIRED", "An active hub must retain a operator contact details, valid opening hours, accepted parcel types, and a valid capacity configuration.");
      }
      return repository.update(id, input);
    },
    async reviewOperator({ id, verificationStatus, notes, actorUserId }) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (current.status === "CLOSED") throw conflict("HUB_CLOSED", "Closed hubs cannot be reviewed.");
      return prismaClient.$transaction(async tx => {
        const updated = await tx.hubPoint.update({ where: { id }, data: { operatorVerificationStatus: verificationStatus, operatorVerifiedAt: verificationStatus === "VERIFIED" ? clock() : null, operatorVerificationNotes: notes ?? null } });
        await tx.operationalAuditEvent.create({ data: { actorUserId, entityType: "HUB_POINT", entityId: id, action: "HUB_OPERATOR_VERIFICATION_REVIEWED", reason: notes ?? null, before: { operatorVerificationStatus: current.operatorVerificationStatus, operatorVerifiedAt: current.operatorVerifiedAt }, after: { operatorVerificationStatus: updated.operatorVerificationStatus, operatorVerifiedAt: updated.operatorVerifiedAt } } });
        return updated;
      });
    },
    async setStatus(id, status) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (current.status === "CLOSED" && status !== "CLOSED") {
        throw conflict("HUB_CLOSED", "Closed hubs cannot be reopened.");
      }
      if (status === "ACTIVE") {
        const now = clock();
        const availability = current.serviceZone.availability.find(item =>
          item.serviceType === PARCEL_SERVICE && item.isEnabled &&
          (!item.startsAt || item.startsAt <= now) && (!item.endsAt || item.endsAt >= now)
        );
        if (!current.serviceZone.isActive || !current.serviceZone.state.isActive ||
          !current.serviceZone.state.country.isActive || !availability) {
          throw conflict("HUB_ZONE_UNAVAILABLE", "The hub's service zone and parcel-delivery availability must be active before the hub can be activated.");
        }
        if (!hasOperationalDetails(current)) {
          throw conflict("HUB_OPERATIONAL_DETAILS_REQUIRED", "Before activation, provide verified operator details, valid opening hours for all weekdays, accepted parcel types, and a valid capacity configuration.");
        }
      }
      return repository.update(id, { status });
    },
  };
}

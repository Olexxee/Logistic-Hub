import { createHubPointsAdminRepository } from "./hub-points.admin.repository.js";
import { openingHoursAdminSchema, capacityConfigAdminSchema } from "./hub-points.admin.validators.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

const PARCEL_SERVICE = "PARCEL_DELIVERY";
async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}
function conflict(code, message) { const error = new Error(message); error.statusCode = 409; error.code = code; return error; }
function hasOperationalDetails(hub) {
  return Boolean(hub.operatorName?.trim() && hub.operatorPhone?.trim() &&
    hub.operatorVerificationStatus === "VERIFIED" &&
    Array.isArray(hub.acceptedParcelTypes) && hub.acceptedParcelTypes.length > 0 &&
    openingHoursAdminSchema.safeParse(hub.openingHours).success &&
    capacityConfigAdminSchema.safeParse(hub.capacityConfig).success);
}

export function createHubPointsAdminService({ prismaClient, clock = () => new Date() }) {
  const repository = createHubPointsAdminRepository({ prismaClient });
  return {
    list() { return repository.list(); },
    async create(input, actorUserId) {
      return serializableTransaction(prismaClient, async tx => {
        const zone = await tx.serviceZone.findUnique({
          where: { id: input.serviceZoneId }, include: { state: { include: { country: true } } },
        });
        if (!zone) return null;
        if (!zone.isActive || !zone.state.isActive || !zone.state.country.isActive) {
          throw conflict("SERVICE_ZONE_INACTIVE", "A hub can only be registered in an active service zone.");
        }
        const { latitude, longitude, ...data } = input;
        const created = await tx.hubPoint.create({ data: { ...data, latitude, longitude, status: "PENDING" } });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "HUB_POINT", entityId: created.id, action: "HUB_POINT_CREATED", after: { serviceZoneId: created.serviceZoneId, name: created.name, status: created.status } });
        return created;
      });
    },
    async update(id, input, actorUserId) {
      return serializableTransaction(prismaClient, async tx => {
        await tx.$queryRaw`SELECT "id" FROM "hub_points" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.hubPoint.findUnique({
          where: { id },
          include: { serviceZone: { include: { state: { include: { country: true } }, availability: true } } },
        });
        if (!current) return null;
        if (current.status === "CLOSED") throw conflict("HUB_CLOSED", "Closed hubs cannot be edited.");
        if (current.status === "ACTIVE" && input.serviceZoneId) {
          throw conflict("ACTIVE_HUB_ZONE_IMMUTABLE", "Suspend a hub before changing its service zone.");
        }
        if (input.serviceZoneId) {
          const zone = await tx.serviceZone.findUnique({
            where: { id: input.serviceZoneId }, include: { state: { include: { country: true } } },
          });
          if (!zone || !zone.isActive || !zone.state?.isActive || !zone.state.country?.isActive) {
            throw conflict("SERVICE_ZONE_INACTIVE", "The selected service zone and its parent geography must be active.");
          }
        }
        const next = { ...current, ...input };
        if (current.status === "ACTIVE" && !hasOperationalDetails(next)) {
          throw conflict("HUB_OPERATIONAL_DETAILS_REQUIRED", "An active hub must retain operator contact details, valid opening hours, accepted parcel types, and a valid capacity configuration.");
        }
        const updated = await tx.hubPoint.update({ where: { id }, data: input });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "HUB_POINT", entityId: id, action: "HUB_POINT_UPDATED", before: { serviceZoneId: current.serviceZoneId, name: current.name, address: current.address, latitude: current.latitude, longitude: current.longitude, operatorName: current.operatorName, operatorPhone: current.operatorPhone, openingHours: current.openingHours, acceptedParcelTypes: current.acceptedParcelTypes, capacityConfig: current.capacityConfig }, after: { serviceZoneId: updated.serviceZoneId, name: updated.name, address: updated.address, latitude: updated.latitude, longitude: updated.longitude, operatorName: updated.operatorName, operatorPhone: updated.operatorPhone, openingHours: updated.openingHours, acceptedParcelTypes: updated.acceptedParcelTypes, capacityConfig: updated.capacityConfig } });
        return updated;
      });
    },
    async reviewOperator({ id, verificationStatus, notes, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const current = await tx.hubPoint.findUnique({ where: { id } });
        if (!current) return null;
        if (current.status === "CLOSED") throw conflict("HUB_CLOSED", "Closed hubs cannot be reviewed.");
        if (current.status === "ACTIVE" && verificationStatus !== "VERIFIED") {
          throw conflict("ACTIVE_HUB_OPERATOR_VERIFICATION_REQUIRED", "Suspend the hub before changing its operator verification away from VERIFIED.");
        }
        const updated = await tx.hubPoint.update({
          where: { id },
          data: { operatorVerificationStatus: verificationStatus, operatorVerifiedAt: verificationStatus === "VERIFIED" ? clock() : null, operatorVerificationNotes: notes ?? null },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "HUB_POINT", entityId: id, action: "HUB_OPERATOR_VERIFICATION_REVIEWED",
          reason: notes,
          before: { operatorVerificationStatus: current.operatorVerificationStatus, operatorVerifiedAt: current.operatorVerifiedAt },
          after: { operatorVerificationStatus: updated.operatorVerificationStatus, operatorVerifiedAt: updated.operatorVerifiedAt },
        });
        return updated;
      });
    },
    async setStatus(id, status, actorUserId) {
      return serializableTransaction(prismaClient, async tx => {
        await tx.$queryRaw`SELECT "id" FROM "hub_points" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.hubPoint.findUnique({
          where: { id },
          include: { serviceZone: { include: { state: { include: { country: true } }, availability: true } } },
        });
        if (!current) return null;
        if (current.status === "CLOSED" && status !== "CLOSED") throw conflict("HUB_CLOSED", "Closed hubs cannot be reopened.");
        if (status === "CLOSED" && current.status !== "CLOSED") {
          const [openLegs, openIntakes, pendingHandovers, openCases, activeOperators] = await Promise.all([
            tx.deliveryLeg.count({
              where: {
                status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] },
                OR: [{ originHubPointId: id }, { destinationHubPointId: id }],
              },
            }),
            tx.hubIntakeRecord.count({ where: { hubPointId: id, status: { in: ["RECEIVED", "EXCEPTION"] } } }),
            tx.custodyHandover.count({ where: { hubPointId: id, status: "PENDING_CONFIRMATION" } }),
            tx.operationalCase.count({ where: { hubPointId: id, status: { in: ["OPEN", "TRIAGED", "IN_PROGRESS"] } } }),
            tx.hubPointOperator.count({ where: { hubPointId: id, isActive: true } }),
          ]);
          if (activeOperators) {
            throw conflict("ACTIVE_HUB_OPERATORS_EXIST", "Deactivate all hub operator memberships before permanently closing this hub.");
          }
          if (openLegs || openIntakes || pendingHandovers || openCases) {
            throw conflict("HUB_HAS_OPEN_OPERATIONS", "Resolve or reassign all active delivery legs, hub intakes, pending handovers and open operational cases before closing this hub.");
          }
        }
        if (status === "ACTIVE") {
          const now = clock();
          const availability = current.serviceZone.availability.find(item =>
            item.serviceType === PARCEL_SERVICE && item.isEnabled &&
            (!item.startsAt || item.startsAt <= now) && (!item.endsAt || item.endsAt >= now));
          if (!current.serviceZone.isActive || !current.serviceZone.state.isActive ||
            !current.serviceZone.state.country.isActive || !availability) {
            throw conflict("HUB_ZONE_UNAVAILABLE", "The hub's service zone and parcel-delivery availability must be active before the hub can be activated.");
          }
          if (!hasOperationalDetails(current)) {
            throw conflict("HUB_OPERATIONAL_DETAILS_REQUIRED", "Before activation, provide verified operator details, valid opening hours for all weekdays, accepted parcel types, and a valid capacity configuration.");
          }
        }
        const updated = await tx.hubPoint.update({ where: { id }, data: { status } });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "HUB_POINT", entityId: id, action: "HUB_STATUS_UPDATED",
          before: { status: current.status }, after: { status: updated.status },
        });
        return updated;
      });
    },
  };
}

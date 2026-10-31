import { createServiceZonesAdminRepository } from "./service-zones.admin.repository.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

function conflict(code, message) { const error = new Error(message); error.statusCode = 409; error.code = code; return error; }
function snapshot(value) { return value ? { id: value.id, stateId: value.stateId, lgaId: value.lgaId, code: value.code, name: value.name, isActive: value.isActive, boundaryGeoJson: value.boundaryGeoJson ?? null } : null; }
async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}
function availabilityIsEffective(value, now) {
  return Boolean(value?.isEnabled && (!value.startsAt || value.startsAt <= now) && (!value.endsAt || value.endsAt >= now));
}

export function createServiceZonesAdminService({ prismaClient, clock = () => new Date() }) {
  const read = createServiceZonesAdminRepository({ prismaClient });
  async function mutate(actorUserId, callback) {
    return serializableTransaction(prismaClient, async tx => callback(tx, createServiceZonesAdminRepository({ prismaClient: tx })));
  }
  return {
    list: () => read.list(),
    async create(input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const state = await tx.state.findUnique({ where: { id: input.stateId }, include: { country: true } });
        if (!state) return null;
        if (!state.isActive || !state.country.isActive) throw conflict("GEOGRAPHY_INACTIVE", "A service zone can only be created under an active state and country.");
        if (input.lgaId) {
          const lga = await tx.lGA.findUnique({ where: { id: input.lgaId } });
          if (!lga || lga.stateId !== state.id) throw conflict("LGA_STATE_MISMATCH", "The selected LGA must belong to the selected state.");
        }
        const created = await r.create(input);
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "SERVICE_ZONE", entityId: created.id, action: "SERVICE_ZONE_CREATED", after: snapshot(created) });
        return created;
      });
    },
    async update(id, input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findById(id); if (!current) return null;
        if (input.lgaId) {
          const lga = await tx.lGA.findUnique({ where: { id: input.lgaId } });
          if (!lga || lga.stateId !== current.stateId) throw conflict("LGA_STATE_MISMATCH", "The selected LGA must belong to the service zone's state.");
        }
        if (Object.hasOwn(input, "lgaId") && input.lgaId !== current.lgaId) {
          const activeHubs = await tx.hubPoint.count({ where: { serviceZoneId: id, status: "ACTIVE" } });
          if (activeHubs) throw conflict("ACTIVE_HUBS_EXIST", "Suspend all active hubs before changing the service zone's LGA.");
        }
        const updated = await r.update(id, input);
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "SERVICE_ZONE", entityId: id, action: "SERVICE_ZONE_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    async setActive(id, isActive, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findById(id); if (!current) return null;
        if (isActive && (!current.state.isActive || !current.state.country.isActive)) throw conflict("GEOGRAPHY_INACTIVE", "A service zone cannot be activated while its state or country is inactive.");
        if (!isActive) {
          const activeHubs = await tx.hubPoint.count({ where: { serviceZoneId: id, status: "ACTIVE" } });
          if (activeHubs) throw conflict("ACTIVE_HUBS_EXIST", "Suspend all active hubs before deactivating this service zone.");
        }
        const updated = await r.update(id, { isActive });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "SERVICE_ZONE", entityId: id, action: "SERVICE_ZONE_STATUS_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    async setAvailability(id, input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findById(id); if (!current) return null;
        if (input.isEnabled && (!current.isActive || !current.state.isActive || !current.state.country.isActive)) throw conflict("SERVICE_ZONE_INACTIVE", "Availability can only be enabled in an active zone, state, and country.");
        const { serviceType, ...data } = input;
        const previous = current.availability.find(item => item.serviceType === serviceType) ?? null;
        if (serviceType === "PARCEL_DELIVERY") {
          const nextAvailability = {
            isEnabled: input.isEnabled,
            startsAt: Object.hasOwn(data, "startsAt") ? data.startsAt : previous?.startsAt ?? null,
            endsAt: Object.hasOwn(data, "endsAt") ? data.endsAt : previous?.endsAt ?? null,
          };
          if (!availabilityIsEffective(nextAvailability, clock())) {
            const activeHubs = await tx.hubPoint.count({ where: { serviceZoneId: id, status: "ACTIVE" } });
            if (activeHubs) throw conflict("ACTIVE_HUBS_EXIST", "Suspend all active hubs before disabling or scheduling parcel-delivery availability outside its active window.");
          }
        }
        const updated = await r.upsertAvailability(id, serviceType, data);
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "SERVICE_AVAILABILITY", entityId: updated.id,
          action: "SERVICE_ZONE_AVAILABILITY_UPDATED",
          before: previous ? { serviceZoneId: id, serviceType, isEnabled: previous.isEnabled, startsAt: previous.startsAt, endsAt: previous.endsAt, config: previous.config ?? null } : null,
          after: { serviceZoneId: id, serviceType, isEnabled: updated.isEnabled, startsAt: updated.startsAt, endsAt: updated.endsAt, config: updated.config ?? null },
        });
        return updated;
      });
    },
  };
}

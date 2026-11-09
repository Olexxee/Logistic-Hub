import { createServiceZonesAdminRepository } from "./service-zones.admin.repository.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";
import { validateServiceZoneBoundary, serviceZoneBoundariesOverlap } from "./geojson-boundary.js";

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
    async listReadiness(serviceType = "PARCEL_DELIVERY") {
      const now = clock();
      const [zones, globalPricingRules] = await Promise.all([
        read.listReadiness({ serviceType, now }),
        read.listGlobalPricingRules({ serviceType, now }),
      ]);
      const assessed = zones.map(zone => {
        let boundary;
        if (zone.boundaryGeoJson == null) {
          boundary = { status: "MISSING", issues: ["A service-zone boundary has not been configured."] };
        } else {
          const result = validateServiceZoneBoundary(zone.boundaryGeoJson);
          boundary = { status: result.valid ? "VALID" : "INVALID", issues: result.issues };
        }
        const availability = zone.availability[0] ?? null;
        const availabilityEffective = availabilityIsEffective(availability, now);
        const geographyActive = Boolean(zone.state?.isActive && zone.state?.country?.isActive);
        const pricingConfigured = zone.pricingRules.length > 0 || globalPricingRules.length > 0;
        const enabledDriverCoverageCount = zone.coverage.length;
        const blockers = [];
        if (!zone.isActive) blockers.push("ZONE_INACTIVE");
        if (!geographyActive) blockers.push("GEOGRAPHY_INACTIVE");
        if (boundary.status === "MISSING") blockers.push("BOUNDARY_MISSING");
        if (boundary.status === "INVALID") blockers.push("BOUNDARY_INVALID");
        if (!availabilityEffective) blockers.push("SERVICE_AVAILABILITY_INACTIVE");
        if (!pricingConfigured) blockers.push("PRICING_UNAVAILABLE");
        return {
          id: zone.id, code: zone.code, name: zone.name,
          state: { id: zone.state.id, code: zone.state.code, name: zone.state.name },
          lga: zone.lga ? { id: zone.lga.id, code: zone.lga.code, name: zone.lga.name } : null,
          isActive: zone.isActive, geographyActive, boundary,
          availability: availability ? { isEnabled: availability.isEnabled, startsAt: availability.startsAt, endsAt: availability.endsAt, effective: availabilityEffective } : null,
          pricingConfigured, enabledDriverCoverageCount,
          bookingReady: blockers.length === 0,
          dispatchCoverageConfigured: enabledDriverCoverageCount > 0,
          blockers,
        };
      });
      const overlapWarnings = [];
      for (let i = 0; i < zones.length; i += 1) {
        const first = zones[i];
        if (!assessed[i].isActive || !assessed[i].geographyActive || assessed[i].boundary.status !== "VALID") continue;
        for (let j = i + 1; j < zones.length; j += 1) {
          const second = zones[j];
          if (!assessed[j].isActive || !assessed[j].geographyActive || assessed[j].boundary.status !== "VALID") continue;
          if (serviceZoneBoundariesOverlap(first.boundaryGeoJson, second.boundaryGeoJson)) {
            overlapWarnings.push({
              zoneIds: [first.id, second.id],
              zones: [{ id: first.id, code: first.code, name: first.name }, { id: second.id, code: second.code, name: second.name }],
              severity: assessed[i].availability?.effective && assessed[j].availability?.effective ? "BLOCKING" : "WARNING",
              affectsCurrentService: Boolean(assessed[i].availability?.effective && assessed[j].availability?.effective),
              code: "ACTIVE_ZONE_BOUNDARY_OVERLAP",
              message: "These active service-zone boundaries overlap or touch. Coordinates in the shared area may be rejected as ambiguous.",
            });
          }
        }
      }
      for (const warning of overlapWarnings) {
        if (!warning.affectsCurrentService) continue;
        for (const zoneId of warning.zoneIds) {
          const zone = assessed.find(item => item.id === zoneId);
          if (zone && !zone.blockers.includes("ACTIVE_ZONE_BOUNDARY_OVERLAP")) {
            zone.blockers.push("ACTIVE_ZONE_BOUNDARY_OVERLAP");
            zone.bookingReady = false;
          }
        }
      }
      return {
        serviceType, assessedAt: now,
        summary: {
          totalZones: assessed.length,
          bookingReadyZones: assessed.filter(zone => zone.bookingReady).length,
          blockedZones: assessed.filter(zone => !zone.bookingReady).length,
          zonesWithoutDispatchCoverage: assessed.filter(zone => zone.bookingReady && !zone.dispatchCoverageConfigured).length,
          activeBoundaryOverlapCount: overlapWarnings.length,
        },
        zones: assessed, overlapWarnings,
      };
    },
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
          before: previous ? { serviceZoneId: id, serviceType, isEnabled: previous.isEnabled, startsAt: previous.startsAt, endsAt: previous.endsAt } : null,
          after: { serviceZoneId: id, serviceType, isEnabled: updated.isEnabled, startsAt: updated.startsAt, endsAt: updated.endsAt },
          metadata: { configChanged: JSON.stringify(previous?.config ?? null) !== JSON.stringify(updated.config ?? null) },
        });
        return updated;
      });
    },
  };
}

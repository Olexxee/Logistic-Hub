import { createGeographyAdminRepository } from "./geography.admin.repository.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

function conflict(code, message) { const e = new Error(message); e.statusCode = 409; e.code = code; return e; }
function snapshot(value) { return value ? { id: value.id, code: value.code, name: value.name, isActive: value.isActive, countryId: value.countryId, stateId: value.stateId } : null; }

async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

export function createGeographyAdminService({ prismaClient }) {
  const read = createGeographyAdminRepository({ prismaClient });
  async function mutate(actorUserId, callback) {
    return serializableTransaction(prismaClient, async tx =>
      callback(tx, createGeographyAdminRepository({ prismaClient: tx })),
    );
  }
  return {
    listCountries: () => read.listCountries(),
    async createCountry(input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const created = await r.createCountry({ ...input, code: input.code.toUpperCase() });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "COUNTRY", entityId: created.id, action: "GEOGRAPHY_COUNTRY_CREATED", after: snapshot(created) });
        return created;
      });
    },
    async updateCountry(id, input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findCountry(id); if (!current) return null;
        const updated = await r.updateCountry(id, { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "COUNTRY", entityId: id, action: "GEOGRAPHY_COUNTRY_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    async setCountryActive(id, isActive, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findCountry(id); if (!current) return null;
        if (!isActive && await tx.state.count({ where: { countryId: id, isActive: true } })) throw conflict("ACTIVE_CHILD_STATES_EXIST", "Deactivate all states before deactivating their country.");
        const updated = await r.updateCountry(id, { isActive });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "COUNTRY", entityId: id, action: "GEOGRAPHY_COUNTRY_STATUS_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    listStates: countryId => read.listStates(countryId ? { countryId } : {}),
    async createState(input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const country = await r.findCountry(input.countryId); if (!country) return null;
        if (!country.isActive) throw conflict("COUNTRY_INACTIVE", "A state can only be created under an active country.");
        const created = await r.createState({ ...input, code: input.code.toUpperCase() });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "STATE", entityId: created.id, action: "GEOGRAPHY_STATE_CREATED", after: snapshot(created) });
        return created;
      });
    },
    async updateState(id, input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findState(id); if (!current) return null;
        const updated = await r.updateState(id, { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "STATE", entityId: id, action: "GEOGRAPHY_STATE_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    async setStateActive(id, isActive, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findState(id); if (!current) return null;
        if (isActive && !current.country.isActive) throw conflict("COUNTRY_INACTIVE", "A state cannot be activated while its country is inactive.");
        if (!isActive && await r.countActiveZonesForState(id)) throw conflict("ACTIVE_SERVICE_ZONES_EXIST", "Deactivate service zones before deactivating this state.");
        const updated = await r.updateState(id, { isActive });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "STATE", entityId: id, action: "GEOGRAPHY_STATE_STATUS_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    listLgas: stateId => read.listLgas(stateId ? { stateId } : {}),
    async createLga(input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const state = await r.findState(input.stateId); if (!state) return null;
        if (!state.isActive || !state.country.isActive) throw conflict("GEOGRAPHY_INACTIVE", "An LGA can only be created under an active state and country.");
        const created = await r.createLga({ ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "LGA", entityId: created.id, action: "GEOGRAPHY_LGA_CREATED", after: snapshot(created) });
        return created;
      });
    },
    async updateLga(id, input, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findLga(id); if (!current) return null;
        const updated = await r.updateLga(id, { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) });
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "LGA", entityId: id, action: "GEOGRAPHY_LGA_UPDATED", before: snapshot(current), after: snapshot(updated) });
        return updated;
      });
    },
    async deleteLga(id, actorUserId) {
      return mutate(actorUserId, async (tx, r) => {
        const current = await r.findLga(id); if (!current) return null;
        if (current._count.zones) throw conflict("LGA_IN_USE", "An LGA referenced by service zones cannot be deleted.");
        const deleted = await r.deleteLga(id);
        await writeOperationalAuditEvent(tx, { actorUserId, entityType: "LGA", entityId: id, action: "GEOGRAPHY_LGA_DELETED", before: snapshot(current) });
        return deleted;
      });
    },
  };
}

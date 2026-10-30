import { createServiceZonesAdminRepository } from "./service-zones.admin.repository.js";

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

export function createServiceZonesAdminService({ prismaClient }) {
  const repository = createServiceZonesAdminRepository({ prismaClient });
  return {
    list: () => repository.list(),
    async create(input) {
      const state = await prismaClient.state.findUnique({
        where: { id: input.stateId }, include: { country: true },
      });
      if (!state) return null;
      if (!state.isActive || !state.country.isActive) {
        throw conflict("GEOGRAPHY_INACTIVE", "A service zone can only be created under an active state and country.");
      }
      if (input.lgaId) {
        const lga = await prismaClient.lGA.findUnique({ where: { id: input.lgaId } });
        if (!lga || lga.stateId !== state.id) {
          throw conflict("LGA_STATE_MISMATCH", "The selected LGA must belong to the selected state.");
        }
      }
      return repository.create(input);
    },
    async update(id, input) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (input.lgaId) {
        const lga = await prismaClient.lGA.findUnique({ where: { id: input.lgaId } });
        if (!lga || lga.stateId !== current.stateId) {
          throw conflict("LGA_STATE_MISMATCH", "The selected LGA must belong to the service zone's state.");
        }
      }
      return repository.update(id, input);
    },
    async setActive(id, isActive) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (isActive && (!current.state.isActive || !current.state.country.isActive)) {
        throw conflict("GEOGRAPHY_INACTIVE", "A service zone cannot be activated while its state or country is inactive.");
      }
      return repository.update(id, { isActive });
    },
    async setAvailability(id, input) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (input.isEnabled && (!current.isActive || !current.state.isActive || !current.state.country.isActive)) {
        throw conflict("SERVICE_ZONE_INACTIVE", "Availability can only be enabled in an active zone, state, and country.");
      }
      const { serviceType, ...data } = input;
      return repository.upsertAvailability(id, serviceType, data);
    },
  };
}

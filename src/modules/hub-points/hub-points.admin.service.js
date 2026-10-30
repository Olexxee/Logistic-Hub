import { createHubPointsAdminRepository } from "./hub-points.admin.repository.js";

const PARCEL_SERVICE = "PARCEL_DELIVERY";

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

export function createHubPointsAdminService({ prismaClient, clock = () => new Date() }) {
  const repository = createHubPointsAdminRepository({ prismaClient });

  return {
    list() {
      return repository.list();
    },
    async create(input) {
      const zone = await prismaClient.serviceZone.findUnique({
        where: { id: input.serviceZoneId },
        include: { state: { include: { country: true } } },
      });
      if (!zone) return null;
      if (!zone.isActive || !zone.state.isActive || !zone.state.country.isActive) {
        throw conflict("SERVICE_ZONE_INACTIVE", "A hub can only be registered in an active service zone.");
      }
      const { latitude, longitude, ...data } = input;
      return repository.create({
        ...data,
        latitude,
        longitude,
        status: "PENDING",
      });
    },
    async update(id, input) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (current.status === "CLOSED") {
        throw conflict("HUB_CLOSED", "Closed hubs cannot be edited.");
      }
      if (current.status === "ACTIVE" && input.serviceZoneId) {
        throw conflict("ACTIVE_HUB_ZONE_IMMUTABLE", "Suspend a hub before changing its service zone.");
      }
      if (input.serviceZoneId) {
        const zone = await prismaClient.serviceZone.findUnique({ where: { id: input.serviceZoneId } });
        if (!zone || !zone.isActive) throw conflict("SERVICE_ZONE_INACTIVE", "The selected service zone must exist and be active.");
      }
      const data = { ...input };
      if (data.latitude !== undefined) data.latitude = data.latitude;
      if (data.longitude !== undefined) data.longitude = data.longitude;
      return repository.update(id, data);
    },
    async setStatus(id, status) {
      const current = await repository.findById(id);
      if (!current) return null;
      if (current.status === "CLOSED" && status !== "CLOSED") {
        throw conflict("HUB_CLOSED", "Closed hubs cannot be reopened.");
      }
      if (status === "ACTIVE") {
        const now = clock();
        const availability = current.serviceZone.availability.find((item) =>
          item.serviceType === PARCEL_SERVICE &&
          item.isEnabled &&
          (!item.startsAt || item.startsAt <= now) &&
          (!item.endsAt || item.endsAt >= now)
        );
        if (!current.serviceZone.isActive || !current.serviceZone.state.isActive ||
          !current.serviceZone.state.country.isActive || !availability) {
          throw conflict("HUB_ZONE_UNAVAILABLE", "The hub's service zone and parcel-delivery availability must be active before the hub can be activated.");
        }
      }
      return repository.update(id, { status });
    },
  };
}

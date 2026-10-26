import { listServiceZonesQuerySchema } from "./service-zones.schemas.js";

export function createServiceZonesService({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async listActive(query) {
      const filters = listServiceZonesQuerySchema.parse(query);
      const now = new Date();
      const activeAvailability = {
        isEnabled: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      };

      const where = {
        isActive: true,
        state: {
          isActive: true,
          country: { isActive: true, code: filters.countryCode },
          ...(filters.stateCode ? { code: filters.stateCode } : {}),
        },
        availability: {
          some: {
            ...activeAvailability,
            ...(filters.serviceType ? { serviceType: filters.serviceType } : {}),
          },
        },
        ...(filters.lgaCode ? { lga: { is: { code: filters.lgaCode } } } : {}),
      };

      const zones = await prismaClient.serviceZone.findMany({
        where,
        orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          state: { select: { code: true, name: true, country: { select: { code: true, name: true } } } },
          lga: { select: { code: true, name: true } },
          availability: {
            where: activeAvailability,
            orderBy: { serviceType: "asc" },
            select: { serviceType: true, isEnabled: true, startsAt: true, endsAt: true },
          },
        },
      });

      return zones
        .map((zone) => ({
          id: zone.id,
          code: zone.code,
          name: zone.name,
          country: zone.state.country,
          state: { code: zone.state.code, name: zone.state.name },
          lga: zone.lga,
          services: zone.availability
            .filter((item) => !filters.serviceType || item.serviceType === filters.serviceType)
            .map((item) => ({
              serviceType: item.serviceType,
              available: true,
              startsAt: item.startsAt?.toISOString() ?? null,
              endsAt: item.endsAt?.toISOString() ?? null,
            })),
        }))
        .filter((zone) => zone.services.length > 0);
    },
  };
}

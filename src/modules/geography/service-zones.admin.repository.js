export function createServiceZonesAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    list: () => prismaClient.serviceZone.findMany({
      orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
      include: { state: { include: { country: true } }, lga: true, availability: true },
    }),
    listReadiness: ({ serviceType, now }) => prismaClient.serviceZone.findMany({
      orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
      include: {
        state: { include: { country: true } },
        lga: true,
        availability: { where: { serviceType } },
        coverage: { where: { serviceType, isEnabled: true }, select: { id: true } },
        pricingRules: {
          where: {
            serviceType, isActive: true, effectiveFrom: { lte: now },
            AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] }],
          },
          select: { id: true },
        },
      },
    }),
    listGlobalPricingRules: ({ serviceType, now }) => prismaClient.pricingRule.findMany({
      where: {
        serviceZoneId: null, serviceType, isActive: true, effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] }],
      },
      select: { id: true },
    }),
    findById: (id) => prismaClient.serviceZone.findUnique({
      where: { id },
      include: { state: { include: { country: true } }, lga: true, availability: true },
    }),
    create: (data) => prismaClient.serviceZone.create({ data }),
    update: (id, data) => prismaClient.serviceZone.update({ where: { id }, data }),
    upsertAvailability: (serviceZoneId, serviceType, data) =>
      prismaClient.serviceAvailability.upsert({
        where: { serviceZoneId_serviceType: { serviceZoneId, serviceType } },
        create: { serviceZoneId, serviceType, ...data },
        update: data,
      }),
  };
}

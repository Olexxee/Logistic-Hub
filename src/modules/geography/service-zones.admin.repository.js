export function createServiceZonesAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    list: () => prismaClient.serviceZone.findMany({
      orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
      include: { state: { include: { country: true } }, lga: true, availability: true },
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

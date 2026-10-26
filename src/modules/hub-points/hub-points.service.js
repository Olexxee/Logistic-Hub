const activeParcelAvailability = (now) => ({
  serviceType: "PARCEL_DELIVERY",
  isEnabled: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

function serializeHubPoint(point) {
  return {
    id: point.id,
    name: point.name,
    address: point.address,
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    openingHours: point.openingHours,
    acceptedParcelTypes: point.acceptedParcelTypes,
    serviceZone: {
      id: point.serviceZone.id,
      code: point.serviceZone.code,
      name: point.serviceZone.name,
      lga: point.serviceZone.lga?.name ?? null,
      state: {
        code: point.serviceZone.state.code,
        name: point.serviceZone.state.name,
        countryCode: point.serviceZone.state.country.code,
        countryName: point.serviceZone.state.country.name,
      },
    },
  };
}

export function createHubPointsService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async listActive(query) {
      const now = clock();
      const where = {
        status: "ACTIVE",
        serviceZone: {
          isActive: true,
          state: {
            isActive: true,
            country: { isActive: true, code: query.countryCode },
            ...(query.stateCode ? { code: query.stateCode } : {}),
          },
          availability: { some: activeParcelAvailability(now) },
          ...(query.serviceZoneId ? { id: query.serviceZoneId } : {}),
          ...(query.lgaName ? { lga: { is: { name: { equals: query.lgaName, mode: "insensitive" } } } } : {}),
        },
        ...(query.q ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { address: { contains: query.q, mode: "insensitive" } },
          ],
        } : {}),
      };

      const points = await prismaClient.hubPoint.findMany({
        where,
        include: {
          serviceZone: {
            include: {
              lga: { select: { name: true } },
              state: { include: { country: { select: { code: true, name: true } } } },
            },
          },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = points.length > query.limit;
      const page = hasMore ? points.slice(0, query.limit) : points;
      return {
        data: page.map(serializeHubPoint),
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      };
    },
  };
}

const activeParcelAvailability = (now) => ({
  serviceType: "PARCEL_DELIVERY",
  isEnabled: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

export function createParcelBookingsRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    findByIdempotencyKey(key) {
      return prismaClient.parcelBooking.findUnique({ where: { idempotencyKey: key }, include: { parcelPackages: { orderBy: { packageSequence: "asc" } } } });
    },
    findServiceableParcelZones(now) {
      return prismaClient.serviceZone.findMany({
        where: {
          isActive: true,
          state: { isActive: true, country: { isActive: true, code: "NG" } },
          availability: { some: activeParcelAvailability(now) },
        },
        select: {
          id: true, code: true, name: true, boundaryGeoJson: true,
          state: { select: { id: true, code: true, name: true, country: { select: { code: true } } } },
          lga: { select: { id: true, code: true, name: true } },
        },
      });
    },
    findActiveParcelZones(zoneIds, now) {
      return prismaClient.serviceZone.findMany({
        where: {
          id: { in: zoneIds }, isActive: true,
          state: { isActive: true, country: { isActive: true } },
          availability: { some: activeParcelAvailability(now) },
        },
        select: { id: true },
      });
    },
    findApplicablePricingRules(pickupServiceZoneId, now) {
      return prismaClient.pricingRule.findMany({
        where: {
          serviceType: "PARCEL_DELIVERY", isActive: true, effectiveFrom: { lte: now },
          AND: [
            { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
            { OR: [{ serviceZoneId: pickupServiceZoneId }, { serviceZoneId: null }] },
          ],
        },
        orderBy: { effectiveFrom: "desc" },
      });
    },
    createWithEvent(data, { actorUserId, metadata, packages = [] }) {
      return prismaClient.$transaction(async (tx) => {
        const created = await tx.parcelBooking.create({
          data: { ...data, parcelPackages: { create: packages } },
          include: { parcelPackages: { orderBy: { packageSequence: "asc" } } },
        });
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: created.id, actorUserId,
            eventType: "PARCEL_BOOKING_CREATED", fromStatus: null, toStatus: "DRAFT", metadata,
          },
        });
        return created;
      });
    },
    findById(id) {
      return prismaClient.parcelBooking.findUnique({ where: { id }, include: { parcelPackages: { orderBy: { packageSequence: "asc" } } } });
    },
    findDeliveryLegsByBookingId(parcelBookingId) {
      return prismaClient.deliveryLeg.findMany({
        where: { parcelBookingId },
        orderBy: { sequence: "asc" },
        include: {
          originServiceZone: { select: { id: true, name: true } },
          destinationServiceZone: { select: { id: true, name: true } },
          originHubPoint: { select: { id: true, name: true } },
          destinationHubPoint: { select: { id: true, name: true } },
          assignments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true, status: true, acceptedAt: true, pickupAt: true,
              startedAt: true, completedAt: true,
            },
          },
        },
      });
    },
    listVisible({ senderId, includeAll, status, paymentStatus, reference, pickupServiceZoneId, destinationServiceZoneId, createdFrom, createdTo, skip, take }) {
      const where = {
        ...(includeAll ? {} : { senderId }),
        ...(status ? { status } : {}),
        ...(paymentStatus ? { paymentStatus } : {}),
        ...(reference ? { publicReference: { contains: reference, mode: "insensitive" } } : {}),
        ...(pickupServiceZoneId ? { pickupServiceZoneId } : {}),
        ...(destinationServiceZoneId ? { destinationServiceZoneId } : {}),
        ...(createdFrom || createdTo ? { createdAt: { ...(createdFrom ? { gte: createdFrom } : {}), ...(createdTo ? { lte: createdTo } : {}) } } : {}),
      };
      return Promise.all([
        prismaClient.parcelBooking.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip,
          take,
          include: { parcelPackages: { orderBy: { packageSequence: "asc" } } },
        }),
        prismaClient.parcelBooking.count({ where }),
      ]).then(([items, total]) => ({ items, total }));
    },
  };
}

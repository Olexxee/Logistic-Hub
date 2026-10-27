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
      return prismaClient.parcelBooking.findUnique({ where: { idempotencyKey: key } });
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
    createWithEvent(data, { actorUserId, metadata }) {
      return prismaClient.$transaction(async (tx) => {
        const created = await tx.parcelBooking.create({ data });
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
      return prismaClient.parcelBooking.findUnique({ where: { id } });
    },
  };
}

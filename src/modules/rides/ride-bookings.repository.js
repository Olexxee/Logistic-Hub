const activeRideAvailability = (now) => ({
  serviceType: "PASSENGER_RIDE",
  isEnabled: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

export function createRideBookingsRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    findByIdempotencyKey(key) {
      return prismaClient.rideBooking.findUnique({ where: { idempotencyKey: key } });
    },
    findActiveRideZones(zoneIds, now) {
      return prismaClient.serviceZone.findMany({
        where: {
          id: { in: zoneIds },
          isActive: true,
          state: { isActive: true, country: { isActive: true } },
          availability: { some: activeRideAvailability(now) },
        },
        select: { id: true },
      });
    },
    findApplicablePricingRules(pickupServiceZoneId, now) {
      return prismaClient.pricingRule.findMany({
        where: {
          serviceType: "PASSENGER_RIDE",
          isActive: true,
          effectiveFrom: { lte: now },
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
        const created = await tx.rideBooking.create({ data });
        await tx.bookingEvent.create({
          data: {
            rideBookingId: created.id,
            actorUserId,
            eventType: "RIDE_BOOKING_CREATED",
            fromStatus: null,
            toStatus: "DRAFT",
            metadata,
          },
        });
        return created;
      });
    },
    findById(id) {
      return prismaClient.rideBooking.findUnique({ where: { id } });
    },
  };
}

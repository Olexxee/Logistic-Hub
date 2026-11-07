import { NotFoundError } from "../../shared/http/app-error.js";

export function createIntegrationShipmentEventsService({ prismaClient } = {}) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async listEvents({ clientId, shipmentId, afterSequence = 0, limit = 50 }) {
      const booking = await prismaClient.parcelBooking.findFirst({
        where: { id: shipmentId, integrationClientId: clientId, senderId: null },
        select: { id: true },
      });
      if (!booking) {
        throw new NotFoundError("Shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
      }

      const rows = await prismaClient.integrationShipmentEvent.findMany({
        where: {
          clientId,
          parcelBookingId: booking.id,
          sequence: { gt: afterSequence },
        },
        orderBy: { sequence: "asc" },
        take: limit + 1,
        select: {
          id: true,
          sequence: true,
          eventType: true,
          schemaVersion: true,
          occurredAt: true,
          payload: true,
        },
      });

      const hasMore = rows.length > limit;
      const events = hasMore ? rows.slice(0, limit) : rows;
      return {
        events,
        hasMore,
        nextAfterSequence: events.length ? events[events.length - 1].sequence : afterSequence,
      };
    },
  };
}

const EXTERNAL_EVENT_TYPES = Object.freeze({
  INTEGRATION_SHIPMENT_CREATED: "shipment.created",
  INTEGRATION_PARTNER_ASSIGNMENT_CREATED: "shipment.partner_assigned",
  INTEGRATION_PARTNER_LEG_STARTED: "shipment.in_transit",
  HUB_PICKUP_CUSTODY_CONFIRMED: "shipment.custody_handover_confirmed",
  HUB_DESTINATION_CUSTODY_CONFIRMED: "shipment.delivery_leg_completed",
  PARTNER_HUB_CUSTODY_CONFIRMED: "shipment.delivery_leg_completed",
});

export async function projectIntegrationShipmentEvent({ tx, parcelBookingId, sourceEvent }) {
  if (!tx || !parcelBookingId || !sourceEvent?.id) {
    throw new Error("A transaction, parcel booking ID and source booking event are required.");
  }

  const eventType = EXTERNAL_EVENT_TYPES[sourceEvent.eventType];
  if (!eventType) return null;

  const existing = await tx.integrationShipmentEvent.findUnique({
    where: { sourceBookingEventId: sourceEvent.id },
    select: { id: true },
  });
  if (existing) return existing;

  const booking = await tx.parcelBooking.findUnique({
    where: { id: parcelBookingId },
    select: {
      id: true,
      integrationClientId: true,
      senderId: true,
      publicReference: true,
      status: true,
    },
  });
  if (!booking?.integrationClientId || booking.senderId != null) return null;

  const updated = await tx.parcelBooking.update({
    where: { id: booking.id },
    data: { integrationEventSequence: { increment: 1 } },
    select: { integrationEventSequence: true },
  });

  const safePayload = {
    shipmentReference: booking.publicReference,
    status: sourceEvent.toStatus ?? booking.status,
  };

  return tx.integrationShipmentEvent.create({
    data: {
      clientId: booking.integrationClientId,
      parcelBookingId: booking.id,
      sourceBookingEventId: sourceEvent.id,
      sequence: updated.integrationEventSequence,
      eventType,
      schemaVersion: 1,
      occurredAt: sourceEvent.createdAt ?? new Date(),
      payload: safePayload,
    },
    select: { id: true, sequence: true, eventType: true },
  });
}

export function createDispatchNotificationsService({ prismaClient, notifications, logger = console }) {
  async function deliver(userId, payload, context) {
    if (!userId) return;
    try {
      await notifications.createAndDeliver({ userId, ...payload });
    } catch (error) {
      logger.warn?.({ code: error.code ?? "NOTIFICATION_FAILED", ...context }, "Dispatch notification delivery failed");
    }
  }
  return {
    async notifyMatchingOffers({ bookingId, requestLog }) {
      const offers = await prismaClient.driverOffer.findMany({
        where: { parcelBookingId: bookingId, status: "OFFERED" },
        include: { driverProfile: { select: { userId: true } }, parcelBooking: { select: { id: true, publicReference: true, pickupAddress: true, destinationAddress: true, parcelCategory: true } } },
      });
      await Promise.all(offers.map((offer) => deliver(offer.driverProfile.userId, {
        type: "PARCEL_OFFER_RECEIVED", title: "New parcel delivery offer",
        body: `A new parcel delivery offer is available for ${offer.parcelBooking.publicReference}. Pickup: ${offer.parcelBooking.pickupAddress}. Destination: ${offer.parcelBooking.destinationAddress}. Category: ${offer.parcelBooking.parcelCategory}. Submit a fare proposal before the offer expires.`,
        data: { bookingId: offer.parcelBooking.id, offerId: offer.id, publicReference: offer.parcelBooking.publicReference },
        deliveryKey: `parcel-offer-${offer.id}`, emailSubject: "New Logistic Hub parcel delivery offer",
      }, { bookingId: offer.parcelBooking.id })));
    },
    async notifyFareProposed({ offerId, result }) {
      const offer = await prismaClient.driverOffer.findUnique({ where: { id: offerId }, include: { parcelBooking: { select: { id: true, senderId: true, publicReference: true } } } });
      if (!offer?.parcelBooking?.senderId) return;
      await deliver(offer.parcelBooking.senderId, {
        type: "PARCEL_FARE_PROPOSED", title: "A driver proposed a fare",
        body: `A driver proposed ${result.proposedFareMinor} ${result.currency} for parcel booking ${offer.parcelBooking.publicReference}. Review the proposal and accept it if suitable. Payment is not collected until you accept a fare.`,
        data: { bookingId: offer.parcelBooking.id, offerId: result.offerId, proposedFareMinor: result.proposedFareMinor, currency: result.currency },
        deliveryKey: `parcel-fare-proposed-${result.offerId}`, emailSubject: "A driver proposed a fare for your Logistic Hub parcel",
      }, { offerId });
    },
    async notifyFareAccepted({ bookingId, assignmentId, paymentExpiresAt }) {
      const assignment = await prismaClient.driverAssignment.findUnique({ where: { id: assignmentId }, include: { driverProfile: { select: { userId: true } }, parcelBooking: { select: { publicReference: true } } } });
      if (!assignment?.driverProfile?.userId) return;
      await deliver(assignment.driverProfile.userId, {
        type: "PARCEL_FARE_ACCEPTED", title: "Your fare proposal was accepted",
        body: `The sender accepted your fare for parcel booking ${assignment.parcelBooking.publicReference}. Payment is still pending. Do not start the delivery until payment is confirmed by Logistic Hub.`,
        data: { bookingId, assignmentId, paymentExpiresAt }, deliveryKey: `parcel-fare-accepted-${assignmentId}`,
        emailSubject: "Your Logistic Hub parcel fare was accepted",
      }, { assignmentId });
    },
  };
}

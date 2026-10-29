export function createRideDispatchNotificationsService({ prismaClient, notifications, logger = console }) {
  async function deliver(userId, payload, context) {
    if (!userId) return;
    try {
      await notifications.createAndDeliver({ userId, ...payload });
    } catch (error) {
      logger.warn?.({ code: error.code ?? "NOTIFICATION_FAILED", ...context }, "Ride dispatch notification delivery failed");
    }
  }
  return {
    async notifyMatchingOffers({ rideBookingId }) {
      const offers = await prismaClient.driverOffer.findMany({
        where: { rideBookingId, status: "OFFERED" },
        include: { driverProfile: { select: { userId: true } }, rideBooking: { select: { id: true, publicReference: true, pickupAddress: true, destinationAddress: true, vehicleType: true } } },
      });
      await Promise.all(offers.map((offer) => deliver(offer.driverProfile.userId, {
        type: "RIDE_OFFER_RECEIVED", title: "New passenger ride offer",
        body: `A new ride offer is available for ${offer.rideBooking.publicReference}. Pickup: ${offer.rideBooking.pickupAddress}. Destination: ${offer.rideBooking.destinationAddress}. Requested vehicle: ${offer.rideBooking.vehicleType}. Submit a fare proposal before the offer expires.`,
        data: { rideBookingId: offer.rideBooking.id, offerId: offer.id, publicReference: offer.rideBooking.publicReference },
        deliveryKey: `ride-offer-${offer.id}`, emailSubject: "New Logistic Hub passenger ride offer",
      }, { rideBookingId: offer.rideBooking.id })));
    },
    async notifyFareProposed({ offerId, result }) {
      const offer = await prismaClient.driverOffer.findUnique({ where: { id: offerId }, include: { rideBooking: { select: { id: true, passengerId: true, publicReference: true } } } });
      if (!offer?.rideBooking?.passengerId) return;
      await deliver(offer.rideBooking.passengerId, {
        type: "RIDE_FARE_PROPOSED", title: "A driver proposed a ride fare",
        body: `A driver proposed ${result.proposedFareMinor} ${result.currency} for ride booking ${offer.rideBooking.publicReference}. Review the proposal and accept it if suitable. Payment is not collected until you accept a fare.`,
        data: { rideBookingId: offer.rideBooking.id, offerId: result.offerId, proposedFareMinor: result.proposedFareMinor, currency: result.currency },
        deliveryKey: `ride-fare-proposed-${result.offerId}`, emailSubject: "A driver proposed a fare for your Logistic Hub ride",
      }, { offerId });
    },
    async notifyFareAccepted({ rideBookingId, assignmentId, paymentExpiresAt }) {
      const assignment = await prismaClient.driverAssignment.findUnique({ where: { id: assignmentId }, include: { driverProfile: { select: { userId: true } }, rideBooking: { select: { publicReference: true } } } });
      if (!assignment?.driverProfile?.userId) return;
      await deliver(assignment.driverProfile.userId, {
        type: "RIDE_FARE_ACCEPTED", title: "Your ride fare proposal was accepted",
        body: `The passenger accepted your fare for ride booking ${assignment.rideBooking.publicReference}. Payment is still pending. Do not start the trip until payment is confirmed by Logistic Hub.`,
        data: { rideBookingId, assignmentId, paymentExpiresAt }, deliveryKey: `ride-fare-accepted-${assignmentId}`,
        emailSubject: "Your Logistic Hub ride fare was accepted",
      }, { assignmentId });
    },
  };
}

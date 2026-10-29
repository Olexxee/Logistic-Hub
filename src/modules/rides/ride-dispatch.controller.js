import { NotFoundError } from "../../shared/http/app-error.js";

export function createRideDispatchController({ service, notifications }) {
  return {
    requestMatching: async (req, res) => {
      const result = await service.requestMatching({ rideBookingId: req.validated.params.rideBookingId, user: req.user });
      if (!result) throw new NotFoundError("Ride booking not found.");
      if (result.offersCreated > 0) await notifications.notifyMatchingOffers({ rideBookingId: result.rideBookingId });
      return res.status(202).json({ success: true, data: result });
    },
    listBookingOffers: async (req, res) => {
      const offers = await service.listPassengerOffers({ rideBookingId: req.validated.params.rideBookingId, user: req.user });
      if (offers === null) throw new NotFoundError("Ride booking not found.");
      return res.status(200).json({ success: true, data: offers });
    },
    listDriverOffers: async (req, res) => res.status(200).json({ success: true, data: await service.listDriverOffers({ userId: req.user.id }) }),
    proposeFare: async (req, res) => {
      const result = await service.proposeFare({ offerId: req.validated.params.offerId, userId: req.user.id, proposedFareMinor: req.validated.body.proposedFareMinor, idempotencyKey: req.validated.idempotencyKey });
      if (!result.replay) await notifications.notifyFareProposed({ offerId: req.validated.params.offerId, result });
      return res.status(200).json({ success: true, data: result });
    },
    acceptFare: async (req, res) => {
      const result = await service.acceptFare({ rideBookingId: req.validated.params.rideBookingId, user: req.user, offerId: req.validated.body.offerId, idempotencyKey: req.validated.idempotencyKey });
      if (!result) throw new NotFoundError("Ride booking not found.");
      if (!result.replay && result.assignmentId) await notifications.notifyFareAccepted({ rideBookingId: req.validated.params.rideBookingId, assignmentId: result.assignmentId, paymentExpiresAt: result.paymentExpiresAt });
      return res.status(200).json({ success: true, data: result });
    },
  };
}

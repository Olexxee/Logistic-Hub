import { ConflictError, NotFoundError } from "../../shared/http/app-error.js";

export function createDispatchController({ service, notifications }) {
  return {
    requestMatching: async (req, res) => {
      const result = await service.requestParcelMatching({ bookingId: req.validated.params.bookingId, user: req.user });
      if (!result) throw new NotFoundError("The parcel booking was not found.");
      if (!result.replay && result.status === "MATCHING" && result.offersCreated > 0) await notifications.notifyMatchingOffers({ bookingId: result.bookingId });
      return res.status(202).json({ success: true, data: result });
    },
    listBookingOffers: async (req, res) => {
      const offers = await service.listParcelOffers({ bookingId: req.validated.params.bookingId, user: req.user });
      if (!offers) throw new NotFoundError("The parcel booking was not found.");
      return res.status(200).json({ success: true, data: offers });
    },
    listDriverOffers: async (req, res) => res.status(200).json({ success: true, data: await service.listDriverOffers({ userId: req.user.id }) }),
    proposeFare: async (req, res) => {
      const result = await service.proposeParcelFare({ offerId: req.validated.params.offerId, userId: req.user.id, proposedFareMinor: req.validated.body.proposedFareMinor, idempotencyKey: req.validated.idempotencyKey });
      if (result.replay !== true) await notifications.notifyFareProposed({ offerId: req.validated.params.offerId, result });
      return res.status(200).json({ success: true, data: result });
    },
    acceptFare: async (req, res) => {
      const result = await service.acceptParcelFare({ bookingId: req.validated.params.bookingId, user: req.user, offerId: req.validated.body.offerId, idempotencyKey: req.validated.idempotencyKey });
      if (!result) throw new NotFoundError("The parcel booking was not found.");
      if (!result.replay && result.assignmentId) await notifications.notifyFareAccepted({ bookingId: req.validated.params.bookingId, assignmentId: result.assignmentId, paymentExpiresAt: result.paymentExpiresAt });
      return res.status(200).json({ success: true, data: result });
    },
  };
}

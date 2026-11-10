import { NotFoundError } from "../../shared/http/app-error.js";

export function createDeliveryLegDispatchController(service) {
  return {
    requestOffers: async (req, res) => res.status(202).json({
      success: true,
      data: await service.requestOffers({ legId: req.validated.params.legId, user: req.user }),
    }),
    requestOffersFromHub: async (req, res) => res.status(202).json({
      success: true,
      data: await service.requestOffers({
        legId: req.validated.params.legId,
        hubPointId: req.validated.params.hubPointId,
        user: req.user,
      }),
    }),
    listDriverOffers: async (req, res) => res.status(200).json({
      success: true,
      data: await service.listDriverOffers({ userId: req.user.id }),
    }),
    acceptFixedPayout: async (req, res) => res.status(200).json({
      success: true,
      data: await service.acceptFixedPayout({
        offerId: req.validated.params.offerId,
        userId: req.user.id,
        vehicleId: req.validated.body.vehicleId,
        idempotencyKey: req.validated.idempotencyKey,
      }),
    }),
    proposeFare: async (req, res) => res.status(200).json({
      success: true,
      data: await service.proposeFare({
        offerId: req.validated.params.offerId,
        userId: req.user.id,
        proposedFareMinor: req.validated.body.proposedFareMinor,
        vehicleId: req.validated.body.vehicleId,
        idempotencyKey: req.validated.idempotencyKey,
      }),
    }),
    listCustomerOffers: async (req, res) => res.status(200).json({
      success: true,
      data: await service.listCustomerOffers({
        bookingId: req.validated.params.bookingId,
        legId: req.validated.params.legId,
        user: req.user,
      }),
    }),
    acceptFare: async (req, res) => res.status(200).json({
      success: true,
      data: await service.acceptFare({
        bookingId: req.validated.params.bookingId,
        legId: req.validated.params.legId,
        offerId: req.validated.body.offerId,
        user: req.user,
        idempotencyKey: req.validated.idempotencyKey,
      }),
    }),
  };
}

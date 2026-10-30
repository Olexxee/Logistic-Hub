import { asyncWrapper } from "../../shared/http/async-wrapper.js";

export function createLegDispatchController(service) {
  return {
    requestMatching: asyncWrapper(async (req, res) => {
      const result = await service.requestMatching({ legId: req.params.legId, user: req.user });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Delivery leg not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
    listCustomerOffers: asyncWrapper(async (req, res) => {
      const result = await service.listCustomerOffers({ legId: req.params.legId, user: req.user });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Delivery leg not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
    listDriverOffers: asyncWrapper(async (req, res) => {
      const result = await service.listDriverOffers({ userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
    }),
    proposeFare: asyncWrapper(async (req, res) => {
      const result = await service.proposeFare({
        offerId: req.params.offerId,
        userId: req.user.id,
        proposedFareMinor: req.body.proposedFareMinor,
        idempotencyKey: req.idempotencyKey,
      });
      return res.status(200).json({ success: true, data: result });
    }),
    acceptFare: asyncWrapper(async (req, res) => {
      const result = await service.acceptFare({
        legId: req.params.legId,
        user: req.user,
        offerId: req.body.offerId,
        idempotencyKey: req.idempotencyKey,
      });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Delivery leg not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
  };
}

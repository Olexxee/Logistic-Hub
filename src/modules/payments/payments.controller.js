import { asyncWrapper } from "../../shared/http/async-wrapper.js";
export function createPaymentsController({ service }) {
  return {
    initialize: asyncWrapper(async (req, res) => {
      const data = await service.initialize({
        user: req.user,
        type: req.body.type,
        bookingId: req.body.bookingId,
        idempotencyKey: req.get("Idempotency-Key"),
      });
      res.status(200).json({ success: true, data });
    }),
    webhook: asyncWrapper(async (req, res) => {
      const data = await service.handleWebhook({ rawBody: req.rawBody, signature: req.get("x-paystack-signature"), payload: req.body });
      res.status(200).json({ success: true, data });
    }),
  };
}

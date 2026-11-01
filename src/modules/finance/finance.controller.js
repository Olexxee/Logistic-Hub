import { asyncWrapper } from "../../shared/http/async-wrapper.js";

export function createFinanceController(service) {
  return {
    requestRefund: asyncWrapper(async (req, res) => {
      const data = await service.requestRefund({
        userId: req.user.id,
        input: req.body,
        idempotencyKey: req.get("Idempotency-Key"),
      });
      res.status(data.replay ? 200 : 201).json({ success: true, data });
    }),
    reviewRefund: asyncWrapper(async (req, res) => {
      const data = await service.reviewRefund({ id: req.params.refundId, user: req.user, ...req.body });
      res.status(200).json({ success: true, data });
    }),
    reconcileRefund: asyncWrapper(async (req, res) => {
      const data = await service.reconcileRefund({ id: req.params.refundId, user: req.user });
      res.status(200).json({ success: true, data });
    }),
    refunds: asyncWrapper(async (req, res) => {
      const data = await service.listRefunds({ status: req.query.status });
      res.status(200).json({ success: true, data });
    }),
    payouts: asyncWrapper(async (req, res) => {
      const data = await service.listPayouts({ status: req.query.status });
      res.status(200).json({ success: true, data });
    }),
    confirmPayout: asyncWrapper(async (req, res) => {
      const data = await service.confirmPayout({
        id: req.params.payoutId,
        providerReference: req.body.providerReference,
        user: req.user,
      });
      res.status(200).json({ success: true, data });
    }),
    reconciliation: asyncWrapper(async (_req, res) => {
      const data = await service.reconciliation();
      res.status(200).json({ success: true, data });
    }),
  };
}

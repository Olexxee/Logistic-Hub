export function createFinancialController({ service }) {
  return {
    requestRefund: async (req, res) =>
      res.status(201).json({
        success: true,
        data: await service.createRefundRequest({
          ...req.validated.body,
          user: req.user,
          idempotencyKey: req.validated.idempotencyKey,
        }),
      }),
    processRefund: async (req, res) =>
      res
        .status(202)
        .json({
          success: true,
          data: await service.processRefund({
            refundId: req.validated.params.refundId,
            actor: req.user,
          }),
        }),
    listRefunds: async (req, res) =>
      res
        .status(200)
        .json({
          success: true,
          ...(await service.listRefunds(req.validated.query)),
        }),
    requestPayout: async (req, res) =>
      res.status(202).json({
        success: true,
        data: await service.requestPayout({
          ...req.validated.body,
          user: req.user,
          idempotencyKey: req.validated.idempotencyKey,
        }),
      }),
    listPayouts: async (req, res) =>
      res
        .status(200)
        .json({
          success: true,
          ...(await service.listPayouts(req.validated.query)),
        }),
    reconcilePayment: async (req, res) =>
      res
        .status(200)
        .json({
          success: true,
          data: await service.reconcilePayment(req.validated.params.reference),
        }),
    reconcilePayout: async (req, res) =>
      res
        .status(200)
        .json({
          success: true,
          data: await service.reconcilePayout(req.validated.params.reference),
        }),
  };
}

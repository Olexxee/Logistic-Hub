export function createPaymentsController({ service }) {
  return {
    initialize: async (req, res) => res.status(201).json({
      success: true,
      data: await service.initialize({
        serviceType: req.validated.body.serviceType,
        bookingId: req.validated.body.bookingId,
        user: req.user,
        idempotencyKey: req.validated.idempotencyKey,
      }),
    }),
    webhook: async (req, res) => {
      const result = await service.handleWebhook({
        rawBody: req.rawBody,
        signature: req.get("x-paystack-signature"),
        event: req.body,
      });
      return res.status(200).json({ success: true, data: result });
    },
  };
}

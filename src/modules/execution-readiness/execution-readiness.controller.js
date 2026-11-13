export function createExecutionReadinessController(service) {
  return {
    selectExecutor: async (req, res) => res.status(201).json({
      success: true,
      data: await service.selectExecutor({
        deliveryLegId: req.validated.params.legId,
        ...req.validated.body,
        selectedByUserId: req.user.id,
        idempotencyKey: req.validated.idempotencyKey,
      }),
    }),
  };
}

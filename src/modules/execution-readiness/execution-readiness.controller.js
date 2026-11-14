export function createExecutionReadinessController(service) {
  return {
    selectExecutor: async (req, res) => {
      const result = await service.selectExecutor({
        deliveryLegId: req.validated.params.legId,
        ...req.validated.body,
        selectedByUserId: req.user.id,
        idempotencyKey: req.validated.idempotencyKey,
      });
      if (result.found === false) return res.status(404).json({
        success: false,
        error: { code: "DELIVERY_LEG_NOT_FOUND", message: "Delivery leg not found." },
      });
      if (result.blocked) return res.status(409).json({
        success: false,
        error: {
          code: "EXECUTION_SELECTION_BLOCKED",
          message: "The delivery leg cannot be released for assignment.",
          details: result.blockers,
        },
      });
      const snapshot = {
        ...result.snapshot,
        executionCostMinor: result.snapshot.executionCostMinor.toString(),
      };
      return res.status(result.replay ? 200 : 201).json({
        success: true,
        data: { snapshot, replay: result.replay },
      });
    },
  };
}

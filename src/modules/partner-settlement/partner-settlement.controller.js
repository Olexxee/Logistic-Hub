export function createPartnerSettlementController(service) {
  return {
    listAdminPayables: async (req, res, next) => {
      try {
        const items = await service.listAdminPayables(req.validatedQuery);
        return res.status(200).json({ success: true, data: { items } });
      } catch (error) { return next(error); }
    },
    listMyPayables: async (req, res, next) => {
      try {
        const items = await service.listMyPayables({ ...req.validatedQuery, userId: req.user.id });
        return res.status(200).json({ success: true, data: { items } });
      } catch (error) { return next(error); }
    },
    approvePayable: async (req, res, next) => {
      try {
        const result = await service.approvePayable({ payableId: req.params.payableId, actorUserId: req.user.id });
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    createAdjustment: async (req, res, next) => {
      try {
        const result = await service.createAdjustment({
          ...req.body, payableId: req.params.payableId,
          idempotencyKey: req.get("Idempotency-Key"), actorUserId: req.user.id,
        });
        return res.status(result.replay ? 200 : 201).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    approveAdjustment: async (req, res, next) => {
      try {
        const result = await service.approveAdjustment({ adjustmentId: req.params.adjustmentId, actorUserId: req.user.id });
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    createBatch: async (req, res, next) => {
      try {
        const result = await service.createBatch({
          ...req.body, partnerId: req.params.partnerId,
          idempotencyKey: req.get("Idempotency-Key"), actorUserId: req.user.id,
        });
        return res.status(result.replay ? 200 : 201).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    approveBatch: async (req, res, next) => {
      try {
        const result = await service.approveBatch({ batchId: req.params.batchId, actorUserId: req.user.id });
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    reconcileBatch: async (req, res, next) => {
      try {
        const result = await service.reconcileBatch({ ...req.body, batchId: req.params.batchId, actorUserId: req.user.id });
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    listAdminBatches: async (req, res, next) => {
      try {
        const items = await service.listAdminBatches(req.validatedQuery);
        return res.status(200).json({ success: true, data: { items } });
      } catch (error) { return next(error); }
    },
  };
}

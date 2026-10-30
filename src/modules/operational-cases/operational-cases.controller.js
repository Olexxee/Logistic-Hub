export function createOperationalCasesController(service) {
  return {
    list: async (req, res) => {
      const result = await service.list(req.query);
      return res.status(200).json({ success: true, data: result.items, page: { nextCursor: result.nextCursor } });
    },
    update: async (req, res) => {
      const result = await service.update({ ...req.body, caseId: req.params.caseId, actorUserId: req.user.id });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "OPERATIONAL_CASE_NOT_FOUND", message: "Operational case not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The selected assignee is not eligible for operational case assignment." } });
      return res.status(200).json({ success: true, data: { operationalCase: result.operationalCase } });
    },
  };
}

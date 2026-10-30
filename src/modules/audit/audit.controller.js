import { createAuditService } from "./audit.service.js";
import { auditListSchema } from "./audit.validators.js";
export function createAuditController({ prismaClient }) {
  const service = createAuditService({ prismaClient });
  return {
    list: async (req, res, next) => {
      const parsed = auditListSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ success: false, error: {
        code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
        details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
      } });
      try { return res.status(200).json({ success: true, data: await service.list(parsed.data) }); }
      catch (error) { return next(error); }
    },
  };
}

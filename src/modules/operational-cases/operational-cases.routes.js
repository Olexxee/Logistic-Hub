import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createOperationalCasesService } from "./operational-cases.service.js";
import { createOperationalCasesController } from "./operational-cases.controller.js";

const id = z.string().trim().min(1).max(128);
const listSchema = z.object({
  status: z.enum(["OPEN", "TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  type: z.enum(["FAILED_HANDOVER", "DAMAGED_PARCEL", "MISSING_PARCEL", "FAILED_DELIVERY", "PARTNER_DELAY", "ROUTE_DISRUPTION", "PRICING_EXCEPTION", "CUSTOMER_DISPUTE", "OTHER"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const updateSchema = z.object({
  status: z.enum(["OPEN", "TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  assignedToUserId: id.nullable().optional(),
  resolution: z.string().trim().min(3).max(2000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: "At least one field must be supplied." });

export function createOperationalCasesRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createOperationalCasesService({ prismaClient });
  const controller = createOperationalCasesController(service);
  router.use(authMiddleware, roleMiddleware("ADMIN"));
  router.get("/admin/operational-cases", (req, res, next) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(controller.list));
  router.patch("/admin/operational-cases/:caseId", (req, res, next) => {
    if (!id.safeParse(req.params.caseId).success) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid case identifier is required." } });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.body = parsed.data;
    return next();
  }, asyncWrapper(controller.update));
  return router;
}
export const operationalCasesRouter = createOperationalCasesRouter();

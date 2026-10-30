import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPartnerExecutionService } from "./partner-execution.service.js";
import { createPartnerExecutionController } from "./partner-execution.controller.js";

const id = z.string().trim().min(1).max(128);
const memberSchema = z.object({
  userId: id,
  role: z.enum(["OWNER", "OPERATIONS", "DISPATCHER"]).default("OPERATIONS"),
}).strict();
const memberStatusSchema = z.object({ isActive: z.boolean() }).strict();
const assignmentSchema = z.object({ partnerId: id }).strict();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

function validate(schema, source = "body") {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    if (source === "query") req.validatedQuery = parsed.data;
    else req.body = parsed.data;
    return next();
  };
}
function validateId(req, res, next) {
  const values = Object.values(req.params);
  if (values.some(value => !id.safeParse(value).success)) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid identifier is required." } });
  }
  return next();
}
function requireIdempotencyKey(req, res, next) {
  const value = req.get("Idempotency-Key");
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 128) {
    return res.status(400).json({ success: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header between 8 and 128 characters." } });
  }
  return next();
}

export function createPartnerExecutionRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createPartnerExecutionService({ prismaClient });
  const controller = createPartnerExecutionController(service);
  const admin = roleMiddleware("ADMIN");

  router.post("/admin/transport-partners/:partnerId/members", authMiddleware, admin, validateId, validate(memberSchema), asyncWrapper(controller.addMember));
  router.patch("/admin/transport-partners/:partnerId/members/:memberId", authMiddleware, admin, validateId, validate(memberStatusSchema), asyncWrapper(controller.setMemberStatus));
  router.post("/admin/delivery-legs/:legId/partner-assignment", authMiddleware, admin, validateId, validate(assignmentSchema), requireIdempotencyKey, asyncWrapper(controller.assignLeg));

  router.get("/partner/assignments", authMiddleware, validate(listSchema, "query"), asyncWrapper(controller.listMyAssignments));
  router.post("/partner/assignments/:assignmentId/accept", authMiddleware, validateId, asyncWrapper(controller.acceptAssignment));
  router.post("/partner/assignments/:assignmentId/start", authMiddleware, validateId, asyncWrapper(controller.startAssignment));

  return router;
}

export const partnerExecutionRouter = createPartnerExecutionRouter();

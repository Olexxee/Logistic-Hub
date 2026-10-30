import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createCustodyService } from "./custody.service.js";
import { createCustodyController } from "./custody.controller.js";

const id = z.string().trim().min(1).max(128);
const evidenceSchema = z.array(z.object({
  uri: z.string().url().max(2048),
  type: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).default("IMAGE"),
  capturedAt: z.string().datetime().optional(),
  note: z.string().trim().max(300).optional(),
}).strict()).max(10).optional();
const operatorSchema = z.object({
  userId: id,
  role: z.enum(["MANAGER", "OPERATOR"]).default("OPERATOR"),
}).strict();
const operatorStatusSchema = z.object({ isActive: z.boolean() }).strict();
const createHandoverSchema = z.object({
  parcelBookingId: id,
  deliveryLegId: id,
  hubPointId: id.optional(),
  fromPartyType: z.enum(["SENDER", "DRIVER", "HUB", "TRANSPORT_PARTNER", "RECIPIENT"]),
  fromPartyId: id,
  toPartyType: z.enum(["SENDER", "DRIVER", "HUB", "TRANSPORT_PARTNER", "RECIPIENT"]),
  toPartyId: id,
  conditionAtRelease: z.string().trim().min(2).max(500),
  evidence: evidenceSchema,
}).strict();
const handoverDecisionSchema = z.object({
  conditionAtReceipt: z.string().trim().min(2).max(500).optional(),
  evidence: evidenceSchema,
  rejectReason: z.string().trim().min(3).max(1000).optional(),
}).strict().refine(value => !(value.rejectReason && !value.conditionAtReceipt && !value.evidence), {
  message: "A rejection must include receipt condition or evidence.",
});

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.body = parsed.data;
    return next();
  };
}
function validateParams(req, res, next) {
  if (Object.values(req.params).some(value => !id.safeParse(value).success)) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid identifier is required." } });
  }
  return next();
}

export function createCustodyRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createCustodyService({ prismaClient });
  const controller = createCustodyController(service);
  const admin = roleMiddleware("ADMIN");

  router.post("/admin/hub-points/:hubPointId/operators", authMiddleware, admin, validateParams, validate(operatorSchema), asyncWrapper(controller.addHubOperator));
  router.patch("/admin/hub-points/:hubPointId/operators/:operatorId", authMiddleware, admin, validateParams, validate(operatorStatusSchema), asyncWrapper(controller.setHubOperatorStatus));
  router.get("/custody/handovers/mine", authMiddleware, asyncWrapper(controller.listMyHandovers));
  router.post("/custody/handovers", authMiddleware, validate(createHandoverSchema), asyncWrapper(controller.createHandover));
  router.post("/custody/handovers/:handoverId/decision", authMiddleware, validateParams, validate(handoverDecisionSchema), asyncWrapper(controller.confirmHandover));

  return router;
}
export const custodyRouter = createCustodyRouter();

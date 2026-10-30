import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPartnerSettlementService } from "./partner-settlement.service.js";
import { createPartnerSettlementController } from "./partner-settlement.controller.js";

const id = z.string().trim().min(1).max(128);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const listSchema = z.object({
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "IN_BATCH", "RECONCILED", "DISPUTED", "VOIDED"]).optional(),
  partnerId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const batchSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
}).strict();
const adjustmentSchema = z.object({
  type: z.enum(["INCREASE", "DECREASE", "REVERSAL"]),
  amountMinor: minor.refine(value => BigInt(value) > 0n, "Adjustment amount must be positive."),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const reconcileSchema = z.object({
  outcome: z.enum(["MATCHED", "VARIANCE", "DISPUTED"]),
  actualAmountMinor: minor,
  externalReference: z.string().trim().min(3).max(200).optional(),
  evidence: z.array(z.object({
    uri: z.string().url().max(2048),
    type: z.enum(["IMAGE", "DOCUMENT"]).default("DOCUMENT"),
    note: z.string().trim().max(300).optional(),
  }).strict()).max(10).optional(),
  note: z.string().trim().max(1000).optional(),
}).strict();

function validate(schema, source = "body") {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
      details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    } });
    if (source === "query") req.validatedQuery = parsed.data;
    else req[source] = parsed.data;
    return next();
  };
}
function validateIds(req, res, next) {
  if (Object.values(req.params).some((value) => !id.safeParse(value).success)) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid identifier is required." } });
  }
  return next();
}
function requireIdempotencyKey(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (typeof key !== "string" || key.trim().length < 8 || key.trim().length > 128) {
    return res.status(400).json({ success: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header between 8 and 128 characters." } });
  }
  return next();
}

export function createPartnerSettlementRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const controller = createPartnerSettlementController(createPartnerSettlementService({ prismaClient }));
  const admin = roleMiddleware("ADMIN");

  router.get("/partner/payables", authMiddleware, validate(listSchema.omit({ partnerId: true }), "query"), asyncWrapper(controller.listMyPayables));
  router.get("/admin/partner-payables", authMiddleware, admin, validate(listSchema, "query"), asyncWrapper(controller.listAdminPayables));
  router.patch("/admin/partner-payables/:payableId/approve", authMiddleware, admin, validateIds, asyncWrapper(controller.approvePayable));
  router.post("/admin/partner-payables/:payableId/adjustments", authMiddleware, admin, validateIds, validate(adjustmentSchema), requireIdempotencyKey, asyncWrapper(controller.createAdjustment));
  router.patch("/admin/partner-payable-adjustments/:adjustmentId/approve", authMiddleware, admin, validateIds, asyncWrapper(controller.approveAdjustment));
  router.post("/admin/transport-partners/:partnerId/settlement-batches", authMiddleware, admin, validateIds, validate(batchSchema), requireIdempotencyKey, asyncWrapper(controller.createBatch));
  router.get("/admin/partner-settlement-batches", authMiddleware, admin, validate(listSchema, "query"), asyncWrapper(controller.listAdminBatches));
  router.patch("/admin/partner-settlement-batches/:batchId/approve", authMiddleware, admin, validateIds, asyncWrapper(controller.approveBatch));
  router.post("/admin/partner-settlement-batches/:batchId/reconcile", authMiddleware, admin, validateIds, validate(reconcileSchema), asyncWrapper(controller.reconcileBatch));

  return router;
}

export const partnerSettlementRouter = createPartnerSettlementRouter();

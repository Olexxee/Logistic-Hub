import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createFinanceService } from "./finance.service.js";
import { createFinanceController } from "./finance.controller.js";
import {
  refundRequestSchema,
  reviewRefundSchema,
} from "./finance.schemas.js";

export function requireFinanceIdempotencyKey(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (typeof key !== "string" || key.trim().length < 8 || key.trim().length > 128) {
    return res.status(400).json({
      success: false,
      error: {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Provide an Idempotency-Key header between 8 and 128 characters.",
      },
    });
  }
  return next();
}

export function createFinanceRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
} = {}) {
  const router = Router();
  const controller = createFinanceController(createFinanceService({ prismaClient }));
  const refundId = z.object({ refundId: z.string().trim().min(1).max(128) });
  const adminAccess = roleMiddleware("ADMIN");

  router.post(
    "/refund-requests",
    authMiddleware,
    roleMiddleware("CUSTOMER"),
    validate(refundRequestSchema),
    requireFinanceIdempotencyKey,
    controller.requestRefund,
  );
  router.get("/admin/refunds", authMiddleware, adminAccess, controller.refunds);
  router.post("/admin/refunds/:refundId/reconcile", authMiddleware, adminAccess, validate(refundId, "params"), controller.reconcileRefund);
  router.patch(
    "/admin/refunds/:refundId",
    authMiddleware,
    adminAccess,
    validate(refundId, "params"),
    validate(reviewRefundSchema),
    controller.reviewRefund,
  );
  router.get("/admin/reconciliation", authMiddleware, adminAccess, controller.reconciliation);

  return router;
}

export const financeRouter = createFinanceRouter();

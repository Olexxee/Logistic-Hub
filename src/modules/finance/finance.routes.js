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
  confirmPayoutSchema,
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

export function createFinanceRouter({ prismaClient = prisma } = {}) {
  const r = Router();
  const c = createFinanceController(createFinanceService({ prismaClient }));
  const refundId = z.object({ refundId: z.string().trim().min(1).max(128) });
  const payoutId = z.object({ payoutId: z.string().trim().min(1).max(128) });
  r.post(
    "/refund-requests",
    requireAuth,
    validate(refundRequestSchema),
    requireFinanceIdempotencyKey,
    c.requestRefund,
  );
  r.get(
    "/admin/refunds",
    requireAuth,
    requireRole("ADMIN", "SUPPORT"),
    c.refunds,
  );
  r.patch(
    "/admin/refunds/:refundId",
    requireAuth,
    requireRole("ADMIN", "SUPPORT"),
    validate(refundId, "params"),
    validate(reviewRefundSchema),
    c.reviewRefund,
  );
  r.get(
    "/admin/payouts",
    requireAuth,
    requireRole("ADMIN", "SUPPORT"),
    c.payouts,
  );
  r.patch(
    "/admin/payouts/:payoutId/confirm-settlement",
    requireAuth,
    requireRole("ADMIN", "SUPPORT"),
    validate(payoutId, "params"),
    validate(confirmPayoutSchema),
    c.confirmPayout,
  );
  r.get(
    "/admin/reconciliation",
    requireAuth,
    requireRole("ADMIN"),
    c.reconciliation,
  );
  return r;
}
export const financeRouter = createFinanceRouter();

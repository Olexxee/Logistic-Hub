import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createPaymentsService } from "./payments.service.js";
import { createFinancialController } from "./financial.controller.js";
import { validateFinancialList, validatePaymentReference, validatePayoutRequest, validateRefundId, validateRefundRequest } from "./financial.validators.js";

export function createFinancialRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createPaymentsService({ prismaClient });
  const controller = createFinancialController({ service });
  const requireAdmin = requireRole("ADMIN");
  const requireFinance = requireRole("ADMIN", "SUPPORT");
  router.post("/refunds/request", requireAuth, validateRefundRequest, asyncWrapper(controller.requestRefund));
  router.get("/refunds/admin", requireAuth, requireFinance, validateFinancialList, asyncWrapper(controller.listRefunds));
  router.post("/refunds/admin/:refundId/process", requireAuth, requireAdmin, validateRefundId, asyncWrapper(controller.processRefund));
  router.post("/payouts/request", requireAuth, requireRole("DRIVER"), validatePayoutRequest, asyncWrapper(controller.requestPayout));
  router.get("/payouts/admin", requireAuth, requireFinance, validateFinancialList, asyncWrapper(controller.listPayouts));
  router.get("/admin/reconciliation/payments/:reference", requireAuth, requireFinance, validatePaymentReference, asyncWrapper(controller.reconcilePayment));
  router.get("/admin/reconciliation/payouts/:reference", requireAuth, requireFinance, validatePaymentReference, asyncWrapper(controller.reconcilePayout));
  return router;
}
export const financialRouter = createFinancialRouter();

import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createPaymentsService } from "./payments.service.js";
import { createPaymentsController } from "./payments.controller.js";
import { validatePaymentInitialization } from "./payments.validators.js";

export function createPaymentsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createPaymentsService({ prismaClient });
  const controller = createPaymentsController({ service });
  router.post("/initialize", requireAuth, validatePaymentInitialization, asyncWrapper(controller.initialize));
  router.post("/webhook", asyncWrapper(controller.webhook));
  return router;
}
export const paymentsRouter = createPaymentsRouter();

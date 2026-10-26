import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createPersistentRateLimit } from "../../shared/http/rate-limit.middleware.js";
import { createPaymentsService } from "./payments.service.js";
import { createPaymentsController } from "./payments.controller.js";
import { initializePaymentSchema } from "./payments.schemas.js";

export function createPaymentsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const controller = createPaymentsController(createPaymentsService({ prismaClient }));
  router.post("/initialize", requireAuth, createPersistentRateLimit({ prismaClient, namespace: "payment-init", limit: 8, windowMs: 60_000 }), validate(initializePaymentSchema), controller.initialize);
  router.post("/webhook/paystack", controller.webhook);
  return router;
}
export const paymentsRouter = createPaymentsRouter();

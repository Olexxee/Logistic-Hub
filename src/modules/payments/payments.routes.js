import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { validateRequest } from "../../shared/http/validate-request.js";
import { createPaymentsController } from "./payments.controller.js";
import { createPaymentsService } from "./payments.service.js";

const initializeSchema = z.object({ type: z.enum(["RIDE", "PARCEL"]), bookingId: z.string().trim().min(1).max(128) }).strict();
export function createPaymentsRouter({ prismaClient = prisma, provider, paymentsEnabled = env.PAYMENTS_ENABLED } = {}) {
  const router = Router();
  const service = createPaymentsService({ prismaClient, provider, paymentsEnabled });
  const controller = createPaymentsController({ service });
  router.post("/initialize", requireAuth, validateRequest(initializeSchema), controller.initialize);
  router.post("/webhook", controller.webhook);
  return router;
}
export const paymentsRouter = createPaymentsRouter();

import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPlatformDriverPayoutController } from "./platform-driver-payout.controller.js";

export function createPlatformDriverPayoutRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
} = {}) {
  const router = Router();
  const controller = createPlatformDriverPayoutController({ prismaClient });
  router.use(authMiddleware, roleMiddleware("ADMIN"));
  router.get("/driver-payout-rules", controller.list);
  router.post("/driver-payout-rules", controller.create);
  router.post("/driver-payout-rules/:ruleId/publish", controller.publish);
  router.post("/driver-payout-rules/:ruleId/retire", controller.retire);
  return router;
}

export const platformDriverPayoutRouter = createPlatformDriverPayoutRouter();

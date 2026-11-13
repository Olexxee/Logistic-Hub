import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPlatformOperationalTariffController } from "./platform-operational-tariff.controller.js";

export function createPlatformOperationalTariffRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
} = {}) {
  const router = Router();
  const controller = createPlatformOperationalTariffController({ prismaClient });
  router.use(authMiddleware, roleMiddleware("ADMIN"));
  router.get("/tariffs", controller.list);
  router.post("/tariffs", controller.create);
  router.post("/tariffs/:tariffId/publish", controller.publish);
  router.post("/tariffs/:tariffId/retire", controller.retire);
  router.get("/availability", controller.listAvailability);
  router.post("/availability", controller.setAvailability);
  return router;
}

export const platformOperationalTariffRouter = createPlatformOperationalTariffRouter();

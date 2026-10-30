import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createDriversAdminController } from "./drivers.admin.controller.js";
export function createDriversAdminRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const controller = createDriversAdminController({ prismaClient });
  router.use(authMiddleware, roleMiddleware("ADMIN"));
  router.get("/drivers", controller.listDrivers);
  router.get("/vehicles", controller.listVehicles);
  router.patch("/drivers/:driverProfileId/status", controller.setDriverStatus);
  router.get("/drivers/:driverProfileId/audit", controller.listDriverAudit);
  return router;
}

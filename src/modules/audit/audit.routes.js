import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createAuditController } from "./audit.controller.js";
export function createAuditRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const controller = createAuditController({ prismaClient });
  router.use(authMiddleware, roleMiddleware("ADMIN"));
  router.get("/", controller.list);
  return router;
}
export const auditRouter = createAuditRouter();

import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createOperationsControlController } from "./operations-control.controller.js";
import { createOperationsControlService } from "./operations-control.service.js";

export function createOperationsControlRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
  clock,
} = {}) {
  const router = Router();
  const service = createOperationsControlService({ prismaClient, clock });
  const controller = createOperationsControlController(service);

  router.get("/admin/operations/overview", authMiddleware, roleMiddleware("ADMIN"), asyncWrapper(controller.overview));

  return router;
}

export const operationsControlRouter = createOperationsControlRouter();

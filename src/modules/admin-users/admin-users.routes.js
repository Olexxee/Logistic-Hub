import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { createAdminUsersController } from "./admin-users.controller.js";
import {
  adminUserParamsSchema,
  adminUserSessionRevocationSchema,
  adminUserStatusSchema,
} from "./admin-users.validators.js";

export function createAdminUsersRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
  clock,
} = {}) {
  const router = Router();
  const controller = createAdminUsersController({ prismaClient, clock });
  const admin = roleMiddleware("ADMIN");

  router.patch(
    "/:userId/status",
    authMiddleware,
    admin,
    validate(adminUserParamsSchema, "params"),
    validate(adminUserStatusSchema, "body"),
    asyncWrapper(controller.updateStatus),
  );

  router.post(
    "/:userId/sessions/revoke-all",
    authMiddleware,
    admin,
    validate(adminUserParamsSchema, "params"),
    validate(adminUserSessionRevocationSchema, "body"),
    asyncWrapper(controller.revokeAllSessions),
  );

  return router;
}

export const adminUsersRouter = createAdminUsersRouter();

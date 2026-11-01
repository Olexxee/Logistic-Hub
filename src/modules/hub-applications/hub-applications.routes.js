import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createHubApplicationsController } from "./hub-applications.controller.js";
import { createHubApplicationSchema, hubApplicationParamsSchema, rejectHubApplicationSchema } from "./hub-applications.validators.js";

function validate(schema, source = "body") {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req[source] = parsed.data;
    return next();
  };
}

export function createHubApplicationsRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole, clock } = {}) {
  const router = Router();
  const controller = createHubApplicationsController({ prismaClient, clock });
  const admin = roleMiddleware("ADMIN");

  router.post("/partner/hub-applications", authMiddleware, validate(createHubApplicationSchema), asyncWrapper(controller.submit));
  router.get("/partner/hub-applications", authMiddleware, asyncWrapper(controller.listMine));
  router.post("/partner/hub-applications/:applicationId/withdraw", authMiddleware, validate(hubApplicationParamsSchema, "params"), asyncWrapper(controller.withdraw));
  router.get("/admin/hub-applications", authMiddleware, admin, asyncWrapper(controller.listAdmin));
  router.post("/admin/hub-applications/:applicationId/approve", authMiddleware, admin, validate(hubApplicationParamsSchema, "params"), asyncWrapper(controller.approve));
  router.post("/admin/hub-applications/:applicationId/reject", authMiddleware, admin, validate(hubApplicationParamsSchema, "params"), validate(rejectHubApplicationSchema), asyncWrapper(controller.reject));

  return router;
}
export const hubApplicationsRouter = createHubApplicationsRouter();

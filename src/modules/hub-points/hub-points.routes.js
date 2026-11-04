import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createHubPointsAdminController } from "./hub-points.admin.controller.js";
import { prisma } from "../../db/prisma.js";
import { createHubPointsService } from "./hub-points.service.js";
import { listHubPointsQuerySchema } from "./hub-points.schemas.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createHubOperatorsAdminController } from "./hub-operators.admin.controller.js";
import {
  addHubOperatorSchema,
  hubOperatorListQuerySchema,
  hubOperatorMemberParamsSchema,
  hubOperatorParamsSchema,
  updateHubOperatorSchema,
} from "./hub-operators.admin.validators.js";

export function createHubPointsRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createHubPointsService({ prismaClient });
  const admin = createHubPointsAdminController({ prismaClient });
  const operators = createHubOperatorsAdminController({ prismaClient });
  const requireAdmin = roleMiddleware("ADMIN");

  const validate = (schema, source = "body") => (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR",
      message: "One or more fields are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req[source] = parsed.data;
    if (source === "query") req.validatedQuery = parsed.data;
    return next();
  };

  router.get("/admin", authMiddleware, requireAdmin, admin.list);
  router.post("/admin", authMiddleware, requireAdmin, admin.create);
  router.get("/admin/:hubPointId/operators", authMiddleware, requireAdmin,
    validate(hubOperatorParamsSchema, "params"), validate(hubOperatorListQuerySchema, "query"),
    asyncWrapper(operators.list));
  router.post("/admin/:hubPointId/operators", authMiddleware, requireAdmin,
    validate(hubOperatorParamsSchema, "params"), validate(addHubOperatorSchema),
    asyncWrapper(operators.add));
  router.patch("/admin/:hubPointId/operators/:memberId", authMiddleware, requireAdmin,
    validate(hubOperatorMemberParamsSchema, "params"), validate(updateHubOperatorSchema),
    asyncWrapper(operators.update));

  router.patch("/admin/:hubPointId", authMiddleware, requireAdmin, admin.update);
  router.patch("/admin/:hubPointId/status", authMiddleware, requireAdmin, admin.setStatus);
  router.patch("/admin/:hubPointId/operator-verification", authMiddleware, requireAdmin, admin.reviewOperator);

  router.get("/", async (req, res, next) => {
    const parsed = listHubPointsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "One or more query parameters are invalid.",
          details: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        },
      });
    }
    try {
      const result = await service.listActive(parsed.data);
      return res.status(200).json({
        success: true,
        data: { items: result.data, nextCursor: result.nextCursor },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const hubPointsRouter = createHubPointsRouter();

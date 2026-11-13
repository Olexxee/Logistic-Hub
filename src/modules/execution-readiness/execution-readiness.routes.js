import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createExecutionReadinessService } from "./execution-readiness.service.js";
import { createExecutionReadinessController } from "./execution-readiness.controller.js";

const id = z.string().trim().min(1).max(128);
const selectionSchema = z.discriminatedUnion("executorType", [
  z.object({
    executorType: z.literal("PLATFORM_DRIVER"),
    driverProfileId: id,
    vehicleId: id,
  }).strict(),
  z.object({
    executorType: z.literal("TRANSPORT_PARTNER"),
    partnerId: id,
  }).strict(),
]);
function validate(schema, source = "body") {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        details: parsed.error.issues.map(issue => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    if (source === "params") req.validated = { ...(req.validated ?? {}), params: parsed.data };
    else req.validated = { ...(req.validated ?? {}), body: parsed.data };
    return next();
  };
}
function validateIdempotencyKey(req, res, next) {
  const value = req.get("Idempotency-Key");
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 128) {
    return res.status(400).json({
      success: false,
      error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header between 8 and 128 characters." },
    });
  }
  req.validated = { ...(req.validated ?? {}), idempotencyKey: value.trim() };
  return next();
}

export function createExecutionReadinessRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
} = {}) {
  const router = Router();
  const service = createExecutionReadinessService({ prismaClient });
  const controller = createExecutionReadinessController(service);
  router.post(
    "/admin/delivery-legs/:legId/execution-snapshot",
    authMiddleware,
    roleMiddleware("ADMIN"),
    validate(z.object({ legId: id }).strict(), "params"),
    validate(selectionSchema),
    validateIdempotencyKey,
    asyncWrapper(controller.selectExecutor),
  );
  return router;
}

export const executionReadinessRouter = createExecutionReadinessRouter();

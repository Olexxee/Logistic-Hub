import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createPersistentRateLimit } from "../../shared/http/rate-limit.middleware.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createAssignmentsService } from "./assignments.service.js";
import { createAssignmentsController } from "./assignments.controller.js";
import { issueCodeSchema, verifyCodeSchema } from "./assignments.schemas.js";
export function createAssignmentsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const controller = createAssignmentsController(
    createAssignmentsService({ prismaClient }),
  );
  const codeIssueLimit = createPersistentRateLimit({
    prismaClient,
    namespace: "assignment-code-issue",
    limit: 3,
    windowMs: 10 * 60_000,
    keyFn: (req) => req.user?.id ?? req.ip,
  });
  const codeVerifyLimit = createPersistentRateLimit({
    prismaClient,
    namespace: "assignment-code-verify",
    limit: 8,
    windowMs: 60_000,
    keyFn: (req) => req.user?.id ?? req.ip,
  });
  const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).strict();
  router.get(
    "/mine",
    requireAuth,
    requireRole("DRIVER"),
    validate(listQuerySchema, "query"),
    controller.listMine,
  );
  const idSchema = z.object({
    assignmentId: z.string().trim().min(1).max(128),
  });
  router.post(
    "/:assignmentId/arrived",
    requireAuth,
    requireRole("DRIVER"),
    validate(idSchema, "params"),
    controller.arrived,
  );
  router.post(
    "/:assignmentId/start",
    requireAuth,
    requireRole("DRIVER"),
    validate(idSchema, "params"),
    controller.start,
  );
  router.post(
    "/:assignmentId/destination-arrived",
    requireAuth,
    requireRole("DRIVER"),
    validate(idSchema, "params"),
    controller.destination,
  );
  router.post(
    "/:assignmentId/verification-codes",
    requireAuth,
    codeIssueLimit,
    validate(idSchema, "params"),
    validate(issueCodeSchema),
    controller.issueCode,
  );
  router.post(
    "/:assignmentId/verify",
    requireAuth,
    requireRole("DRIVER"),
    codeVerifyLimit,
    validate(idSchema, "params"),
    validate(verifyCodeSchema),
    controller.verifyCode,
  );
  router.get(
    "/:assignmentId/location",
    requireAuth,
    validate(idSchema, "params"),
    controller.location,
  );
  return router;
}
export const assignmentsRouter = createAssignmentsRouter();

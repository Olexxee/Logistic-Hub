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
  const idSchema = z.object({
    assignmentId: z.string().trim().min(1).max(128),
  });
  const adminHoldSchema = z.object({reason:z.string().trim().min(5).max(1000)}).strict();
  const recoveryIdSchema = z.object({ recoveryId: z.string().trim().min(1).max(128) }).strict();
  const recoveryEvidenceSchema = z.array(z.object({
    uri: z.string().url().max(2048),
    type: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).default("IMAGE"),
    capturedAt: z.string().datetime().optional(),
    note: z.string().trim().max(300).optional(),
  }).strict()).min(1).max(10);
  const initiateRecoverySchema = z.object({
    replacementDriverProfileId: z.string().trim().min(1).max(128),
    replacementVehicleId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(10).max(1000),
  }).strict();
  const recoveryReleaseSchema = z.object({
    reason: z.string().trim().min(5).max(1000),
    evidence: recoveryEvidenceSchema,
  }).strict();
  const recoveryExceptionSchema = z.object({
    reason: z.string().trim().min(10).max(1000),
    evidence: recoveryEvidenceSchema,
  }).strict();
  const recoveryReceiptSchema = z.object({
    conditionAtReceipt: z.string().trim().min(2).max(500),
    evidence: recoveryEvidenceSchema,
  }).strict();
  router.post(
    "/admin/:assignmentId/recoveries",
    requireAuth, requireRole("ADMIN"),
    validate(idSchema, "params"), validate(initiateRecoverySchema),
    controller.initiateCustodyRecovery,
  );
  router.post(
    "/admin/recoveries/:recoveryId/release-exception",
    requireAuth, requireRole("ADMIN"),
    validate(recoveryIdSchema, "params"), validate(recoveryExceptionSchema),
    controller.authorizeCustodyRecoveryReleaseException,
  );
  router.post(
    "/recoveries/:recoveryId/release",
    requireAuth, requireRole("DRIVER"),
    validate(recoveryIdSchema, "params"), validate(recoveryReleaseSchema),
    controller.confirmCustodyRecoveryRelease,
  );
  router.post(
    "/recoveries/:recoveryId/receive",
    requireAuth, requireRole("DRIVER"),
    validate(recoveryIdSchema, "params"), validate(recoveryReceiptSchema),
    controller.confirmCustodyRecoveryReceipt,
  );
  router.get(
    "/admin/execution-holds",
    requireAuth,
    requireRole("ADMIN"),
    validate(listQuerySchema, "query"),
    controller.listExecutionHolds,
  );
  router.post(
    "/admin/:assignmentId/execution-hold",
    requireAuth,
    requireRole("ADMIN"),
    validate(idSchema, "params"),
    validate(adminHoldSchema),
    controller.placeExecutionHold,
  );
  router.post(
    "/admin/:assignmentId/execution-hold/release",
    requireAuth,
    requireRole("ADMIN"),
    validate(idSchema, "params"),
    validate(adminHoldSchema),
    controller.releaseExecutionHold,
  );
  router.get(
    "/mine",
    requireAuth,
    requireRole("DRIVER"),
    validate(listQuerySchema, "query"),
    controller.listMine,
  );
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

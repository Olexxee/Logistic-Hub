import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createPartnerApiAuth } from "./partner-execution.auth.js";
import { createPartnerExecutionController } from "./partner-execution.controller.js";

const assignmentParams = z.object({ assignmentId: z.string().trim().min(1).max(128) });
const credentialParams = z.object({ partnerId: z.string().trim().min(1).max(128), credentialId: z.string().trim().min(1).max(128) });
const partnerParams = z.object({ partnerId: z.string().trim().min(1).max(128) });
const rejectBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const credentialBody = z.object({ label: z.string().trim().min(2).max(80), expiresAt: z.string().datetime().optional() }).strict();

export function createPartnerExecutionRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const controller = createPartnerExecutionController({ prismaClient });
  router.use(createPartnerApiAuth({ prismaClient }));
  router.get("/partner/assignments", controller.list);
  router.post("/partner/assignments/:assignmentId/accept", validate(assignmentParams, "params"), controller.accept);
  router.post("/partner/assignments/:assignmentId/reject", validate(assignmentParams, "params"), validate(rejectBody), controller.reject);
  router.post("/partner/assignments/:assignmentId/start", validate(assignmentParams, "params"), controller.start);
  router.post("/partner/assignments/:assignmentId/arrived-at-hub", validate(assignmentParams, "params"), controller.arrive);
  return router;
}

export function createPartnerExecutionAdminRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const controller = createPartnerExecutionController({ prismaClient });
  router.use(requireAuth, requireRole("ADMIN"));
  router.post("/transport-partners/:partnerId/api-credentials", validate(partnerParams, "params"), validate(credentialBody), controller.issueCredential);
  router.post("/transport-partners/:partnerId/api-credentials/:credentialId/revoke", validate(credentialParams, "params"), controller.revokeCredential);
  return router;
}

export const partnerExecutionRouter = createPartnerExecutionRouter();
export const partnerExecutionAdminRouter = createPartnerExecutionAdminRouter();

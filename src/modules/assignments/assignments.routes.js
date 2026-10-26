import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { validateRequest } from "../../shared/http/validate-request.js";
import { createAssignmentsController } from "./assignments.controller.js";
import { createAssignmentsService } from "./assignments.service.js";

const idSchema = z.object({ assignmentId: z.string().trim().min(1).max(128) }).strict();
const issueSchema = z.object({ action: z.enum(["PARCEL_PICKUP", "PARCEL_DELIVERY", "RIDE_PICKUP", "RIDE_COMPLETION"]) }).strict();
const verifySchema = issueSchema.extend({ code: z.string().regex(/^\d{6}$/) }).strict();
export function createAssignmentsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createAssignmentsService({ prismaClient });
  const controller = createAssignmentsController({ service });
  router.use(requireAuth);
  router.post("/:assignmentId/verification-codes", validateRequest(idSchema, "params"), validateRequest(issueSchema), controller.issueCode);
  router.post("/:assignmentId/verify", validateRequest(idSchema, "params"), validateRequest(verifySchema), controller.verifyCode);
  router.post("/:assignmentId/arrived-pickup", validateRequest(idSchema, "params"), controller.arrivedPickup);
  router.post("/:assignmentId/arrived-destination", validateRequest(idSchema, "params"), controller.arrivedDestination);
  return router;
}
export const assignmentsRouter = createAssignmentsRouter();

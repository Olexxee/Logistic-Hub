import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createAssignmentsService } from "./assignments.service.js";
import { createAssignmentsController } from "./assignments.controller.js";
import { validateAssignmentId, validateVerificationCode } from "./assignments.validators.js";

export function createAssignmentsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createAssignmentsService({ prismaClient });
  const controller = createAssignmentsController({ service });
  router.post("/:assignmentId/verification-code", validateAssignmentId, asyncWrapper(controller.issueVerificationCode));
  router.post("/:assignmentId/arrived-at-pickup", validateAssignmentId, asyncWrapper(controller.markArrivedAtPickup));
  router.post("/:assignmentId/verify-code", validateAssignmentId, validateVerificationCode, asyncWrapper(controller.verifyCode));
  router.post("/:assignmentId/start-transit", validateAssignmentId, asyncWrapper(controller.startParcelTransit));
  router.post("/:assignmentId/arrived-at-destination", validateAssignmentId, asyncWrapper(controller.markArrivedAtDestination));
  router.get("/:assignmentId/driver-location", validateAssignmentId, asyncWrapper(controller.location));
  return router;
}
export const assignmentsRouter = createAssignmentsRouter();

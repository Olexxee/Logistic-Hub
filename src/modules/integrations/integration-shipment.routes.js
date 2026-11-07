import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireIntegrationAuth, requireIntegrationScope } from "./integration-auth.middleware.js";
import { createIntegrationShipmentController } from "./integration-shipment.controller.js";
import { integrationShipmentCreateSchema } from "./integration-shipment.validators.js";

export function createIntegrationShipmentRouter({ prismaClient = prisma, clock, authMiddleware = requireIntegrationAuth } = {}) {
  const router = Router();
  const controller = createIntegrationShipmentController({ prismaClient, clock });
  router.use(authMiddleware);

  router.post("/shipments", requireIntegrationScope("shipments:write"),
    validate(integrationShipmentCreateSchema), asyncWrapper(controller.create));

  return router;
}

export const integrationShipmentRouter = createIntegrationShipmentRouter();

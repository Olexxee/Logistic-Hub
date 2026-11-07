import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireIntegrationAuth, requireIntegrationScope } from "./integration-auth.middleware.js";
import { createIntegrationShipmentController } from "./integration-shipment.controller.js";
import { createIntegrationShipmentReadController } from "./integration-shipment-read.controller.js";
import { integrationShipmentCreateSchema } from "./integration-shipment.validators.js";
import {
  integrationShipmentExternalReferenceParamsSchema,
  integrationShipmentIdParamsSchema,
} from "./integration-shipment-read.validators.js";

export function createIntegrationShipmentRouter({ prismaClient = prisma, clock, authMiddleware = requireIntegrationAuth } = {}) {
  const router = Router();
  const createController = createIntegrationShipmentController({ prismaClient, clock });
  const readController = createIntegrationShipmentReadController({ prismaClient });

  router.use(authMiddleware);
  router.post("/shipments", requireIntegrationScope("shipments:write"),
    validate(integrationShipmentCreateSchema), asyncWrapper(createController.create));
  router.get("/shipments/by-external-reference/:externalFulfillmentReference", requireIntegrationScope("shipments:read"),
    validate(integrationShipmentExternalReferenceParamsSchema, "params"), asyncWrapper(readController.getByExternalReference));
  router.get("/shipments/:shipmentId", requireIntegrationScope("shipments:read"),
    validate(integrationShipmentIdParamsSchema, "params"), asyncWrapper(readController.getById));

  return router;
}

export const integrationShipmentRouter = createIntegrationShipmentRouter();

import { Router, raw } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireIntegrationAuth, requireIntegrationScope } from "./integration-auth.middleware.js";
import { createIntegrationPackingEvidenceController } from "./integration-packing-evidence.controller.js";
import { integrationPackingEvidenceParamsSchema, integrationPackingEvidenceIdParamsSchema } from "./integration-packing-evidence.validators.js";

export function createIntegrationPackingEvidenceRouter({ prismaClient = prisma, clock, authMiddleware = requireIntegrationAuth } = {}) {
  const router = Router();
  const controller = createIntegrationPackingEvidenceController({ prismaClient, clock });
  router.use(authMiddleware);
  router.post("/shipments/by-external-reference/:externalFulfillmentReference/packing-evidence",
    requireIntegrationScope("shipments:write"),
    validate(integrationPackingEvidenceParamsSchema, "params"),
    (req, res, next) => req.headers["content-type"]?.split(";")[0].trim() === "application/octet-stream"
      ? next()
      : res.status(415).json({ success: false, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Upload evidence as application/octet-stream." } }),
    raw({ type: "application/octet-stream", limit: "5mb" }),
    asyncWrapper(controller.upload));
  router.get("/shipments/by-external-reference/:externalFulfillmentReference/packing-evidence",
    requireIntegrationScope("shipments:read"),
    validate(integrationPackingEvidenceParamsSchema, "params"),
    asyncWrapper(controller.list));
  router.get("/packing-evidence/:evidenceId/download",
    requireIntegrationScope("shipments:read"),
    validate(integrationPackingEvidenceIdParamsSchema, "params"),
    asyncWrapper(controller.download));
  return router;
}

export const integrationPackingEvidenceRouter = createIntegrationPackingEvidenceRouter();

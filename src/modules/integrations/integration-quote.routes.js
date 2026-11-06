import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireIntegrationAuth, requireIntegrationScope } from "./integration-auth.middleware.js";
import { createIntegrationQuoteController } from "./integration-quote.controller.js";
import {
  integrationQuoteCreateSchema, integrationQuoteOptionParamsSchema, integrationQuoteParamsSchema,
} from "./integration-quote.validators.js";

export function createIntegrationQuoteRouter({ prismaClient = prisma, clock, authMiddleware = requireIntegrationAuth } = {}) {
  const router = Router();
  const controller = createIntegrationQuoteController({ prismaClient, clock });
  router.use(authMiddleware);

  router.post("/quotes", requireIntegrationScope("quotes:write"),
    validate(integrationQuoteCreateSchema), asyncWrapper(controller.create));
  router.get("/quotes/:quoteSessionId", requireIntegrationScope("quotes:read"),
    validate(integrationQuoteParamsSchema, "params"), asyncWrapper(controller.get));
  router.post("/quotes/:quoteSessionId/options/:optionId/accept", requireIntegrationScope("quotes:write"),
    validate(integrationQuoteOptionParamsSchema, "params"), asyncWrapper(controller.accept));

  return router;
}

export const integrationQuoteRouter = createIntegrationQuoteRouter();

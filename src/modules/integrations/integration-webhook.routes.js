import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireIntegrationAuth, requireIntegrationScope } from "./integration-auth.middleware.js";
import { createIntegrationWebhookController } from "./integration-webhook.controller.js";
import {
  integrationWebhookEndpointCreateSchema,
  integrationWebhookEndpointParamsSchema,
  integrationWebhookEndpointUpdateSchema,
  integrationWebhookSecretRotateSchema,
} from "./integration-webhook.validators.js";
import { z } from "zod";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export function createIntegrationWebhookRouter({
  prismaClient = prisma,
  authMiddleware = requireIntegrationAuth,
  clock,
  lookup,
  encryptionKey,
} = {}) {
  const router = Router();
  const controller = createIntegrationWebhookController({ prismaClient, clock, lookup, encryptionKey });
  router.use(authMiddleware, requireIntegrationScope("webhooks:manage"));
  router.get("/webhooks", validate(listQuerySchema, "query"), asyncWrapper(controller.list));
  router.post("/webhooks", validate(integrationWebhookEndpointCreateSchema), asyncWrapper(controller.create));
  router.patch("/webhooks/:endpointId",
    validate(integrationWebhookEndpointParamsSchema, "params"),
    validate(integrationWebhookEndpointUpdateSchema),
    asyncWrapper(controller.update));
  router.post("/webhooks/:endpointId/rotate-secret",
    validate(integrationWebhookEndpointParamsSchema, "params"),
    validate(integrationWebhookSecretRotateSchema),
    asyncWrapper(controller.rotateSecret));
  return router;
}

export const integrationWebhookRouter = createIntegrationWebhookRouter();

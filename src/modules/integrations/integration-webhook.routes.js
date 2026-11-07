import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireIntegrationAuth, requireIntegrationScope } from "./integration-auth.middleware.js";
import { createIntegrationWebhookController } from "./integration-webhook.controller.js";
import {
  integrationWebhookDeliveryListQuerySchema,
  integrationWebhookEndpointCreateSchema,
  integrationWebhookEndpointParamsSchema,
  integrationWebhookEndpointUpdateSchema,
  integrationWebhookReplaySchema,
  integrationWebhookSecretRotateSchema,
} from "./integration-webhook.validators.js";

const listQuerySchema = integrationWebhookDeliveryListQuerySchema.pick({ page: true, limit: true });

export function createIntegrationWebhookRouter({
  prismaClient = prisma,
  authMiddleware = requireIntegrationAuth,
  clock,
  lookup,
  encryptionKey,
} = {}) {
  const router = Router();
  const controller = createIntegrationWebhookController({ prismaClient, clock, lookup, encryptionKey });
  router.use(authMiddleware);

  router.get("/webhooks", requireIntegrationScope("webhooks:manage"),
    validate(listQuerySchema, "query"), asyncWrapper(controller.list));
  router.post("/webhooks", requireIntegrationScope("webhooks:manage"),
    validate(integrationWebhookEndpointCreateSchema), asyncWrapper(controller.create));
  router.patch("/webhooks/:endpointId", requireIntegrationScope("webhooks:manage"),
    validate(integrationWebhookEndpointParamsSchema, "params"),
    validate(integrationWebhookEndpointUpdateSchema), asyncWrapper(controller.update));
  router.post("/webhooks/:endpointId/rotate-secret", requireIntegrationScope("webhooks:manage"),
    validate(integrationWebhookEndpointParamsSchema, "params"),
    validate(integrationWebhookSecretRotateSchema), asyncWrapper(controller.rotateSecret));

  router.get("/webhooks/deliveries", requireIntegrationScope("webhooks:read"),
    validate(integrationWebhookDeliveryListQuerySchema, "query"), asyncWrapper(controller.listDeliveries));
  router.post("/webhooks/:endpointId/replay", requireIntegrationScope("webhooks:manage"),
    validate(integrationWebhookEndpointParamsSchema, "params"),
    validate(integrationWebhookReplaySchema), asyncWrapper(controller.replay));

  return router;
}

export const integrationWebhookRouter = createIntegrationWebhookRouter();

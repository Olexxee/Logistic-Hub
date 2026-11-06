import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createIntegrationsAdminController } from "./integrations-admin.controller.js";
import {
  integrationAgreementCreateSchema, integrationClientCreateSchema, integrationClientListQuerySchema,
  integrationClientParamsSchema, integrationClientStatusSchema, integrationCredentialCreateSchema,
  integrationCredentialParamsSchema, integrationCredentialRevokeSchema,
} from "./integrations-admin.validators.js";

export function createIntegrationsAdminRouter({
  prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole, clock,
} = {}) {
  const router = Router();
  const controller = createIntegrationsAdminController({ prismaClient, clock });
  router.use(authMiddleware, roleMiddleware("ADMIN"));

  router.get("/", validate(integrationClientListQuerySchema, "query"), asyncWrapper(controller.listClients));
  router.post("/", validate(integrationClientCreateSchema), asyncWrapper(controller.createClient));
  router.patch("/:clientId/status",
    validate(integrationClientParamsSchema, "params"), validate(integrationClientStatusSchema),
    asyncWrapper(controller.updateClientStatus));
  router.post("/:clientId/credentials",
    validate(integrationClientParamsSchema, "params"), validate(integrationCredentialCreateSchema),
    asyncWrapper(controller.issueCredential));
  router.post("/credentials/:credentialId/revoke",
    validate(integrationCredentialParamsSchema, "params"), validate(integrationCredentialRevokeSchema),
    asyncWrapper(controller.revokeCredential));
  router.post("/:clientId/billing-agreements",
    validate(integrationClientParamsSchema, "params"), validate(integrationAgreementCreateSchema),
    asyncWrapper(controller.createBillingAgreement));

  return router;
}

export const integrationsAdminRouter = createIntegrationsAdminRouter();

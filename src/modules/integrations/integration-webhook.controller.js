import { createIntegrationWebhookService } from "./integration-webhook.service.js";

export function createIntegrationWebhookController({ prismaClient, clock, lookup, encryptionKey } = {}) {
  const service = createIntegrationWebhookService({ prismaClient, clock, lookup, encryptionKey });
  return {
    list: async (req, res) => res.status(200).json({
      success: true,
      data: await service.listEndpoints({ clientId: req.integrationClient.id, ...req.validated.query }),
    }),
    create: async (req, res) => res.status(201).json({
      success: true,
      data: await service.createEndpoint({
        clientId: req.integrationClient.id,
        credentialId: req.integrationClient.credentialId,
        ...req.validated.body,
      }),
    }),
    update: async (req, res) => res.status(200).json({
      success: true,
      data: await service.updateEndpoint({
        clientId: req.integrationClient.id,
        credentialId: req.integrationClient.credentialId,
        endpointId: req.validated.params.endpointId,
        ...req.validated.body,
      }),
    }),
    rotateSecret: async (req, res) => res.status(200).json({
      success: true,
      data: await service.rotateSecret({
        clientId: req.integrationClient.id,
        credentialId: req.integrationClient.credentialId,
        endpointId: req.validated.params.endpointId,
        ...req.validated.body,
      }),
    }),
  };
}

import { createIntegrationWebhookService } from "./integration-webhook.service.js";
import { createIntegrationWebhookOperationsService } from "./integration-webhook-operations.service.js";

export function createIntegrationWebhookController({ prismaClient, clock, lookup, encryptionKey } = {}) {
  const service = createIntegrationWebhookService({ prismaClient, clock, lookup, encryptionKey });
  const operations = createIntegrationWebhookOperationsService({ prismaClient, clock });
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
    listDeliveries: async (req, res) => res.status(200).json({
      success: true,
      data: await operations.listDeliveries({
        clientId: req.integrationClient.id,
        ...req.validated.query,
      }),
    }),
    replay: async (req, res) => res.status(202).json({
      success: true,
      data: await operations.replayDeliveries({
        clientId: req.integrationClient.id,
        credentialId: req.integrationClient.credentialId,
        endpointId: req.validated.params.endpointId,
        ...req.validated.body,
      }),
    }),
  };
}

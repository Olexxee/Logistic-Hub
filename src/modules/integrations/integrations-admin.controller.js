import { createIntegrationsAdminService } from "./integrations-admin.service.js";

export function createIntegrationsAdminController({ prismaClient, clock }) {
  const service = createIntegrationsAdminService({ prismaClient, clock });
  return {
    listClients: async (req, res) => res.status(200).json({ success: true, data: await service.listClients(req.validated.query) }),
    createClient: async (req, res) => res.status(201).json({ success: true, data: await service.createClient({ ...req.body, actorUserId: req.user.id }) }),
    updateClientStatus: async (req, res) => res.status(200).json({
      success: true,
      data: await service.updateClientStatus({ clientId: req.params.clientId, ...req.body, actorUserId: req.user.id }),
    }),
    issueCredential: async (req, res) => res.status(201).json({
      success: true,
      data: await service.issueCredential({ clientId: req.params.clientId, ...req.body, actorUserId: req.user.id }),
    }),
    revokeCredential: async (req, res) => res.status(200).json({
      success: true,
      data: await service.revokeCredential({ credentialId: req.params.credentialId, ...req.body, actorUserId: req.user.id }),
    }),
    updateBillingAgreementStatus: async (req, res) => res.status(200).json({
      success: true,
      data: await service.updateBillingAgreementStatus({ clientId: req.params.clientId, agreementId: req.params.agreementId, ...req.body, actorUserId: req.user.id }),
    }),
    createBillingAgreement: async (req, res) => res.status(201).json({
      success: true,
      data: await service.createBillingAgreement({ clientId: req.params.clientId, ...req.body, actorUserId: req.user.id }),
    }),
  };
}

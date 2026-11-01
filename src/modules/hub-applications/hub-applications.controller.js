import { createHubApplicationsService } from "./hub-applications.service.js";

export function createHubApplicationsController({ prismaClient, clock }) {
  const service = createHubApplicationsService({ prismaClient, clock });
  return {
    submit: async (req, res) => {
      const result = await service.submit(req.body, req.user.id);
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result });
    },
    listMine: async (req, res) => {
      const items = await service.listMine(req.user.id);
      return res.status(200).json({ success: true, data: { items } });
    },
    listAdmin: async (_req, res) => {
      const items = await service.listAdmin();
      return res.status(200).json({ success: true, data: { items } });
    },
    approve: async (req, res) => {
      const result = await service.approve(req.params.applicationId, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_APPLICATION_NOT_FOUND", message: "Hub application not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The hub application cannot be approved in its current state." } });
      return res.status(200).json({ success: true, data: result });
    },
    reject: async (req, res) => {
      const result = await service.reject(req.params.applicationId, req.body.reason, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_APPLICATION_NOT_FOUND", message: "Hub application not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "Only pending hub applications can be rejected." } });
      return res.status(200).json({ success: true, data: result });
    },
  };
}

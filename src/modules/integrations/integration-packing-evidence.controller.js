import { createIntegrationPackingEvidenceService } from "./integration-packing-evidence.service.js";
import { validatePackingEvidenceHeaders } from "./integration-packing-evidence.validators.js";

export function createIntegrationPackingEvidenceController({ prismaClient, clock } = {}) {
  const service = createIntegrationPackingEvidenceService({ prismaClient, clock });
  return {
    async upload(req, res) {
      const metadata = validatePackingEvidenceHeaders(req.headers);
      const result = await service.upload({
        client: req.integrationClient,
        externalFulfillmentReference: req.params.externalFulfillmentReference,
        metadata,
        buffer: req.body,
      });
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result });
    },
    async list(req, res) {
      const result = await service.list({
        client: req.integrationClient,
        externalFulfillmentReference: req.params.externalFulfillmentReference,
      });
      return res.status(200).json({ success: true, data: result });
    },
    async download(req, res) {
      const file = await service.download({ client: req.integrationClient, evidenceId: req.params.evidenceId });
      const safeName = file.originalName.replace(/["\\\r\n]/g, "_");
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Length", String(file.buffer.length));
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(file.buffer);
    },
  };
}

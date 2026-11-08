import { createIntegrationShipmentService } from "./integration-shipment.service.js";
import { ValidationError } from "../../shared/http/app-error.js";

export function createIntegrationShipmentController({ prismaClient, clock } = {}) {
  const service = createIntegrationShipmentService({ prismaClient, clock });
  function requireIdempotencyKey(req) {
    const key = req.get("idempotency-key")?.trim();
    if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new ValidationError("A valid Idempotency-Key header (8–128 characters) is required.", {
        field: "Idempotency-Key",
      });
    }
    return key;
  }

  return {
    async freezePackingEvidence(req, res) {
      const result = await service.freezePackingEvidence({
        client: req.integrationClient,
        idempotencyKey: requireIdempotencyKey(req),
        externalFulfillmentReference: req.params.externalFulfillmentReference,
      });
      return res.status(result.statusCode).json({
        success: true,
        data: { ...result.body, replay: result.replay === true },
      });
    },
    async authorizeDispatch(req, res) {
      const result = await service.authorizeDispatch({
        client: req.integrationClient,
        idempotencyKey: requireIdempotencyKey(req),
        externalFulfillmentReference: req.params.externalFulfillmentReference,
        reason: req.body.reason,
      });
      return res.status(result.statusCode).json({
        success: true,
        data: { ...result.body, replay: result.replay === true },
      });
    },
    async create(req, res) {
      const result = await service.createShipment({
        client: req.integrationClient,
        idempotencyKey: requireIdempotencyKey(req),
        input: req.body,
      });
      return res.status(result.statusCode).json({
        success: true,
        data: { ...result.body, replay: result.replay === true },
      });
    },
  };
}

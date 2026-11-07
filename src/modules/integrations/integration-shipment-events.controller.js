import { createIntegrationShipmentEventsService } from "./integration-shipment-events.service.js";

export function createIntegrationShipmentEventsController({ prismaClient } = {}) {
  const service = createIntegrationShipmentEventsService({ prismaClient });
  return {
    async list(req, res) {
      const result = await service.listEvents({
        clientId: req.integrationClient.id,
        shipmentId: req.params.shipmentId,
        afterSequence: req.query.afterSequence,
        limit: req.query.limit,
      });
      return res.status(200).json({ success: true, data: result });
    },
  };
}

import { createIntegrationShipmentService } from "./integration-shipment-read.service.js";

export function createIntegrationShipmentReadController({ prismaClient } = {}) {
  const service = createIntegrationShipmentService({ prismaClient });
  return {
    async getById(req, res) {
      const shipment = await service.getShipment({
        clientId: req.integrationClient.id,
        shipmentId: req.params.shipmentId,
      });
      return res.status(200).json({ success: true, data: { shipment } });
    },

    async getByExternalReference(req, res) {
      const shipment = await service.getShipmentByExternalReference({
        clientId: req.integrationClient.id,
        externalFulfillmentReference: req.params.externalFulfillmentReference,
      });
      return res.status(200).json({ success: true, data: { shipment } });
    },
  };
}

import { z } from "zod";

const pathReference = z.string().trim().min(1).max(128);

export const integrationShipmentIdParamsSchema = z.object({
  shipmentId: pathReference,
}).strict();

export const integrationShipmentExternalReferenceParamsSchema = z.object({
  externalFulfillmentReference: pathReference,
}).strict();

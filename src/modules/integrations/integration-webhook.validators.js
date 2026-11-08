import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const eventType = z.enum([
  "shipment.created",
  "shipment.partner_assigned",
  "shipment.in_transit",
  "shipment.custody_handover_confirmed",
  "shipment.delivery_leg_completed",
  "shipment.cancelled",
  "shipment.return_requested",
]);

export const integrationWebhookEndpointCreateSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  description: z.string().trim().max(160).optional(),
  eventTypes: z.array(eventType).min(1).max(7).refine(values => new Set(values).size === values.length, { message: "Event types must be unique." }),
}).strict();

export const integrationWebhookEndpointParamsSchema = z.object({ endpointId: id }).strict();

export const integrationWebhookEndpointUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]).optional(),
  description: z.string().trim().max(160).nullable().optional(),
  eventTypes: z.array(eventType).min(1).max(7).refine(values => new Set(values).size === values.length, { message: "Event types must be unique." }).optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one endpoint field must be supplied.",
});

export const integrationWebhookSecretRotateSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();


const deliveryStatus = z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "DEAD"]);

export const integrationWebhookDeliveryListQuerySchema = z.object({
  endpointId: id.optional(),
  status: deliveryStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const integrationWebhookReplaySchema = z.union([
  z.object({ eventId: id }).strict(),
  z.object({
    shipmentId: id,
    fromSequence: z.number().int().min(1).max(2147483646),
    toSequence: z.number().int().min(1).max(2147483646),
  }).strict(),
]);

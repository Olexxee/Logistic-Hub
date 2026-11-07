import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const eventType = z.enum([
  "shipment.created",
  "shipment.partner_assigned",
  "shipment.in_transit",
  "shipment.custody_handover_confirmed",
  "shipment.delivery_leg_completed",
]);

export const integrationWebhookEndpointCreateSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  description: z.string().trim().max(160).optional(),
  eventTypes: z.array(eventType).min(1).max(5),
}).strict();

export const integrationWebhookEndpointParamsSchema = z.object({ endpointId: id }).strict();

export const integrationWebhookEndpointUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]).optional(),
  description: z.string().trim().max(160).nullable().optional(),
  eventTypes: z.array(eventType).min(1).max(5).optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one endpoint field must be supplied.",
});

export const integrationWebhookSecretRotateSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();

import { z } from "zod";

const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

export const createParcelBookingSchema = z.object({
  // Optional compatibility hints only; the backend resolves authoritative zones from coordinates.
  pickupServiceZoneId: z.string().trim().min(1).max(128).optional(),
  destinationServiceZoneId: z.string().trim().min(1).max(128).optional(),
  pickupAddress: z.string().trim().min(3).max(500),
  pickup: coordinatesSchema,
  pickupInstructions: z.string().trim().max(1000).optional(),
  destinationAddress: z.string().trim().min(3).max(500),
  destination: coordinatesSchema,
  recipientName: z.string().trim().min(1).max(160),
  recipientPhone: z.string().trim().min(7).max(32),
  parcelCategory: z.string().trim().min(1).max(80),
  parcelDescription: z.string().trim().max(2000).optional(),
  parcelSize: z.string().trim().min(1).max(80),
  declaredValueMinor: z.string().regex(/^(0|[1-9][0-9]{0,14})$/).optional(),
  handlingInstructions: z.string().trim().max(1000).optional(),
}).strict();

export const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

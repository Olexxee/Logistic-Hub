import { z } from "zod";

export const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const geocodeInputSchema = z.object({
  address: z.string().trim().min(3).max(500),
});

export const routeInputSchema = z.object({
  origin: coordinatesSchema,
  destination: coordinatesSchema,
  travelMode: z.enum(["DRIVE", "TWO_WHEELER", "WALK", "BICYCLE"]).default("DRIVE"),
});

export const geocodeResultSchema = z.object({
  formattedAddress: z.string().min(1),
  location: coordinatesSchema,
  placeId: z.string().optional(),
});

export const routeResultSchema = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  encodedPolyline: z.string().optional(),
});

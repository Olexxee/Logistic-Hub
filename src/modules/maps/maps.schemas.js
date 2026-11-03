import { z } from "zod";

export const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const autocompleteInputSchema = z.object({
  input: z.string().trim().min(2).max(200),
  sessionToken: z.string().trim().min(1).max(256).optional(),
}).strict();

export const placeDetailsInputSchema = z.object({
  placeId: z.string().trim().min(1).max(256),
  sessionToken: z.string().trim().min(1).max(256).optional(),
}).strict();

export const autocompleteSuggestionSchema = z.object({
  placeId: z.string().min(1),
  text: z.string().min(1),
  mainText: z.string().optional(),
  secondaryText: z.string().optional(),
  types: z.array(z.string()).default([]),
});

export const autocompleteResultSchema = z.object({
  suggestions: z.array(autocompleteSuggestionSchema),
});

export const placeAddressComponentSchema = z.object({
  longText: z.string(),
  shortText: z.string(),
  types: z.array(z.string()),
});

export const placeDetailsResultSchema = z.object({
  placeId: z.string().min(1),
  formattedAddress: z.string().min(1),
  location: coordinatesSchema,
  countryCode: z.literal("NG"),
  addressComponents: z.array(placeAddressComponentSchema),
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

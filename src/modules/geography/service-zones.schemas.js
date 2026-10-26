import { z } from "zod";

export const serviceTypeSchema = z.enum([
  "PARCEL_DELIVERY",
  "PASSENGER_RIDE",
  "HUB_POINT",
  "BUSINESS_LOGISTICS",
]);

export const listServiceZonesQuerySchema = z.object({
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/).default("NG"),
  stateCode: z.string().trim().regex(/^NG-[A-Z]{2}$/).optional(),
  lgaCode: z.string().trim().min(1).max(32).optional(),
  serviceType: serviceTypeSchema.optional(),
}).strict();

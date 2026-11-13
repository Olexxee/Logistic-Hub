import { z } from "zod";
import { isCanonicalPlatformRouteWeightBand } from "./platform-route-weight-bands.js";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(5).max(1000);

export const availabilitySchema = z.object({
  originServiceZoneId: id,
  destinationServiceZoneId: id,
  serviceType: z.literal("PARCEL_DELIVERY").default("PARCEL_DELIVERY"),
  isEnabled: z.boolean(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  reason,
}).strict()
  .refine(value => value.originServiceZoneId !== value.destinationServiceZoneId, {
    message: "Origin and destination must differ.",
    path: ["destinationServiceZoneId"],
  })
  .refine(value => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
    message: "endsAt must be later than startsAt.",
    path: ["endsAt"],
  });

export const availabilityListSchema = z.object({
  originServiceZoneId: id.optional(),
  destinationServiceZoneId: id.optional(),
  serviceType: z.literal("PARCEL_DELIVERY").optional(),
}).strict();

export const rateSchema = z.object({
  originServiceZoneId: id,
  destinationServiceZoneId: id,
  serviceType: z.literal("PARCEL_DELIVERY").default("PARCEL_DELIVERY"),
  parcelCategory: z.string().trim().min(2).max(80),
  minWeightGrams: z.number().int().positive(),
  maxWeightGrams: z.number().int().positive(),
  maxLengthMm: z.number().int().positive().optional(),
  maxWidthMm: z.number().int().positive().optional(),
  maxHeightMm: z.number().int().positive().optional(),
  currency: z.string().trim().length(3).default("NGN").transform(value => value.toUpperCase()),
  customerTransportChargeMinor: z.string().regex(/^[1-9][0-9]{0,14}$/),
  platformChargeMinor: z.string().regex(/^(0|[1-9][0-9]{0,14})$/).default("0"),
  driverPayoutMinor: z.string().regex(/^[1-9][0-9]{0,14}$/),
  estimatedTransitMinutes: z.number().int().positive().optional(),
  effectiveFrom: z.coerce.date().default(() => new Date()),
  effectiveUntil: z.coerce.date().optional(),
  reason,
}).strict()
  .refine(value => value.originServiceZoneId !== value.destinationServiceZoneId, {
    message: "Origin and destination must differ.",
    path: ["destinationServiceZoneId"],
  })
  .refine(value => isCanonicalPlatformRouteWeightBand(value.minWeightGrams, value.maxWeightGrams), {
    message: "Select exactly one of the seven supported platform weight bands (0.001–30.000 kg).",
    path: ["minWeightGrams"],
  })
  .refine(value => !value.effectiveUntil || value.effectiveUntil > value.effectiveFrom, {
    message: "effectiveUntil must be later than effectiveFrom.",
    path: ["effectiveUntil"],
  });

export const reasonSchema = z.object({ reason }).strict();
export const listSchema = z.object({
  originServiceZoneId: id.optional(),
  destinationServiceZoneId: id.optional(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]).optional(),
}).strict();

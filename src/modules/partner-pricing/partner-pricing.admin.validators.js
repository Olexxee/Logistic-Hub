import { z } from "zod";
const id = z.string().trim().min(1).max(128);
export const partnerIdSchema = id;
export const partnerInputSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().email().max(254).optional(),
  contactPhone: z.string().trim().min(7).max(32).optional(),
}).strict();
export const partnerStatusInputSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]),
  verificationStatus: z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).optional(),
}).strict();
export const agreementInputSchema = z.object({
  reference: z.string().trim().min(2).max(100),
  currency: z.string().trim().length(3).default("NGN"),
  effectiveFrom: z.coerce.date().default(() => new Date()),
  effectiveUntil: z.coerce.date().optional(),
  volumeCommitment: z.record(z.string(), z.unknown()).optional(),
  serviceStandards: z.record(z.string(), z.unknown()).optional(),
  custodyClaimsTerms: z.record(z.string(), z.unknown()).optional(),
}).strict().refine(v => !v.effectiveUntil || v.effectiveUntil > v.effectiveFrom, {
  message: "effectiveUntil must be later than effectiveFrom.", path: ["effectiveUntil"],
});
export const agreementStatusInputSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"]),
}).strict();
export const rateCardInputSchema = z.object({
  currency: z.string().trim().length(3).default("NGN"),
  effectiveFrom: z.coerce.date().default(() => new Date()),
  effectiveUntil: z.coerce.date().optional(),
}).strict().refine(v => !v.effectiveUntil || v.effectiveUntil > v.effectiveFrom, {
  message: "effectiveUntil must be later than effectiveFrom.", path: ["effectiveUntil"],
});
export const partnerRateInputSchema = z.object({
  originServiceZoneId: id,
  destinationServiceZoneId: id,
  serviceType: z.enum(["PARCEL_DELIVERY", "PASSENGER_RIDE", "HUB_POINT", "BUSINESS_LOGISTICS"]).default("PARCEL_DELIVERY"),
  parcelCategory: z.string().trim().min(2).max(80),
  minWeightGrams: z.number().int().min(0).max(100000000).default(0),
  maxWeightGrams: z.number().int().min(1).max(100000000).optional(),
  maxLengthMm: z.number().int().min(1).max(1000000).optional(),
  maxWidthMm: z.number().int().min(1).max(1000000).optional(),
  maxHeightMm: z.number().int().min(1).max(1000000).optional(),
  transportChargeMinor: z.string().regex(/^[1-9][0-9]{0,14}$/),
  estimatedTransitMinutes: z.number().int().min(1).max(1000000).optional(),
}).strict().refine(v => v.maxWeightGrams === undefined || v.maxWeightGrams >= v.minWeightGrams, {
  message: "maxWeightGrams must be greater than or equal to minWeightGrams.", path: ["maxWeightGrams"],
});

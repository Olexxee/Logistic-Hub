import { z } from "zod";

const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const jsonObject = z.record(z.string(), z.unknown()).nullable().optional();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const slot = z.object({ opensAt: time, closesAt: time }).strict()
  .refine(value => value.closesAt > value.opensAt, { message: "Closing time must be later than opening time.", path: ["closesAt"] });
const weekdays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export const openingHoursAdminSchema = z.object(Object.fromEntries(
  weekdays.map(day => [day, z.array(slot).max(3)])
)).strict();
export const capacityConfigAdminSchema = z.object({
  maxParcels: z.number().int().min(1).max(100000),
  maxWeightGrams: z.number().int().min(1).max(100000000).optional(),
  maxVolumeCm3: z.number().int().min(1).max(1000000000).optional(),
}).strict();

export const createHubPointAdminSchema = z.object({
  partnerId: z.string().trim().min(1).max(128).optional(),
  serviceZoneId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  operatorName: optionalText(120),
  operatorPhone: optionalText(32),
  openingHours: openingHoursAdminSchema.nullable().optional(),
  acceptedParcelTypes: z.array(z.string().trim().min(1).max(60)).min(1).max(30).optional(),
  capacityConfig: capacityConfigAdminSchema.nullable().optional(),
}).strict();

export const updateHubPointAdminSchema = createHubPointAdminSchema
  .omit({ serviceZoneId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be supplied");

export const hubPointStatusAdminSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
}).strict();

export const hubOperatorVerificationSchema = z.object({
  verificationStatus: z.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED"]),
  notes: z.string().trim().max(500).optional(),
}).strict();

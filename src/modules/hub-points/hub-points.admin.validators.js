import { z } from "zod";

const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const jsonObject = z.record(z.string(), z.unknown()).nullable().optional();

export const createHubPointAdminSchema = z.object({
  serviceZoneId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  operatorName: optionalText(120),
  operatorPhone: optionalText(32),
  openingHours: jsonObject,
  acceptedParcelTypes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  capacityConfig: jsonObject,
}).strict();

export const updateHubPointAdminSchema = createHubPointAdminSchema
  .omit({ serviceZoneId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be supplied");

export const hubPointStatusAdminSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
}).strict();

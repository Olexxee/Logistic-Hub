import { z } from "zod";
import { serviceTypeSchema } from "./service-zones.schemas.js";

export const createServiceZoneAdminSchema = z.object({
  stateId: z.string().trim().min(1).max(128),
  lgaId: z.string().trim().min(1).max(128).nullable().optional(),
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  boundaryGeoJson: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

export const updateServiceZoneAdminSchema = createServiceZoneAdminSchema
  .omit({ stateId: true }).partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be supplied");

export const serviceZoneStatusAdminSchema = z.object({ isActive: z.boolean() }).strict();

export const serviceAvailabilityAdminSchema = z.object({
  serviceType: serviceTypeSchema,
  isEnabled: z.boolean(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
  message: "endsAt must be later than startsAt.", path: ["endsAt"],
});

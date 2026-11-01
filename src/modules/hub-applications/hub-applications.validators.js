import { z } from "zod";
import { openingHoursAdminSchema, capacityConfigAdminSchema } from "../hub-points/hub-points.admin.validators.js";

const id = z.string().trim().min(1).max(128);
export const createHubApplicationSchema = z.object({
  partnerId: id,
  serviceZoneId: id,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  operatorName: z.string().trim().min(2).max(120),
  operatorPhone: z.string().trim().min(7).max(32),
  openingHours: openingHoursAdminSchema,
  acceptedParcelTypes: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  capacityConfig: capacityConfigAdminSchema,
}).strict();

export const hubApplicationParamsSchema = z.object({ applicationId: id }).strict();
export const rejectHubApplicationSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
}).strict();

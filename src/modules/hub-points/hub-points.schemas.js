import { z } from "zod";

export const listHubPointsQuerySchema = z.object({
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/).default("NG"),
  stateCode: z.string().trim().regex(/^NG-[A-Z]{2}$/).optional(),
  lgaName: z.string().trim().min(1).max(100).optional(),
  serviceZoneId: z.string().trim().min(1).max(128).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

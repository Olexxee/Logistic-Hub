import { z } from "zod";
export const auditListSchema = z.object({
  entityType: z.enum(["DRIVER_PROFILE", "HUB_POINT", "TRANSPORT_PARTNER", "PARTNER_AGREEMENT", "PARTNER_RATE_CARD"]).optional(),
  entityId: z.string().trim().min(1).max(128).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  actorUserId: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

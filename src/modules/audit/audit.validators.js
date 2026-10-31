import { z } from "zod";

export const auditListSchema = z.object({
  // Entity types are intentionally extensible: every module may emit audit events.
  entityType: z.string().trim().min(1).max(80).optional(),
  entityId: z.string().trim().min(1).max(128).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  actorUserId: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

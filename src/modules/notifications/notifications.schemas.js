import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

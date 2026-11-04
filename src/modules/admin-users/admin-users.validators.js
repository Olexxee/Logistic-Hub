import { z } from "zod";

const id = z.string().trim().min(1).max(128);

export const adminUserParamsSchema = z.object({ userId: id }).strict();

export const adminUserListQuerySchema = z.object({
  search: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["CUSTOMER", "DRIVER", "HUB_OPERATOR", "PARTNER_OPERATOR", "SUPPORT", "ADMIN"]).optional(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const adminUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().min(5).max(500),
}).strict();

export const adminUserSessionRevocationSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();

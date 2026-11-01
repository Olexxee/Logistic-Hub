import { z } from "zod";

const id = z.string().trim().min(1).max(128);

export const adminUserParamsSchema = z.object({ userId: id }).strict();

export const adminUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().min(5).max(500),
}).strict();

export const adminUserSessionRevocationSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();

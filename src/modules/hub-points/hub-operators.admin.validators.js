import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(5).max(1000);

export const hubOperatorListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(160).optional(),
  role: z.enum(["MANAGER", "OPERATOR"]).optional(),
  isActive: z.enum(["true", "false"]).transform(value => value === "true").optional(),
}).strict();

export const addHubOperatorSchema = z.object({
  userId: id,
  role: z.enum(["MANAGER", "OPERATOR"]).default("OPERATOR"),
  canDispatch: z.boolean().default(false),
  reason,
}).strict();

export const updateHubOperatorSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(["MANAGER", "OPERATOR"]).optional(),
  canDispatch: z.boolean().optional(),
  reason,
}).strict().refine(value => value.isActive !== undefined || value.role !== undefined || value.canDispatch !== undefined, {
  message: "Provide isActive, role or canDispatch when updating a hub membership.",
});

export const hubOperatorParamsSchema = z.object({ hubPointId: id }).strict();
export const hubOperatorMemberParamsSchema = z.object({ hubPointId: id, memberId: id }).strict();

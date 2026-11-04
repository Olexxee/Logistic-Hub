import { z } from "zod";
const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
export const driverAdminListSchema = z.object({
  ...pagination,
  verificationStatus: z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).optional(),
  kycTier: z.enum(["UNASSESSED", "TEST_LIMITED", "FULL"]).optional(),
}).strict();
export const vehicleAdminListSchema = z.object({
  ...pagination,
  verificationStatus: z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).optional(),
  isActive: z.enum(["true", "false"]).transform(value => value === "true").optional(),
}).strict();

export const driverAdminStatusSchema = z.object({ status: z.enum(["SUSPENDED", "ACTIVE"]), reason: z.string().trim().min(3).max(500).optional() }).strict().refine(v => Boolean(v.reason), { message: "A reason is required for every driver status change.", path: ["reason"] });

export const driverAdminAuditSchema = z.object({ ...pagination }).strict();

import { z } from "zod";
const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
export const driverAdminListSchema = z.object({
  ...pagination,
  verificationStatus: z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).optional(),
}).strict();
export const vehicleAdminListSchema = z.object({
  ...pagination,
  verificationStatus: z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).optional(),
  isActive: z.enum(["true", "false"]).transform(value => value === "true").optional(),
}).strict();

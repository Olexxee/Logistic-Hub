import { z } from "zod";
export const issueCodeSchema = z.object({ action: z.enum(["PICKUP", "DELIVERY"]) }).strict();
export const verifyCodeSchema = z.object({ action: z.enum(["PICKUP", "DELIVERY"]), code: z.string().regex(/^[0-9]{6}$/) }).strict();

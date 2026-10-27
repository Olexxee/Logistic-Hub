import { z } from "zod";
export const initializePaymentSchema = z.object({ bookingType: z.enum(["PARCEL", "RIDE"]), bookingId: z.string().trim().min(1).max(128) }).strict();
export const paystackWebhookSchema = z.object({ event: z.string().min(1), data: z.object({ id: z.union([z.string(), z.number()]).optional(), reference: z.string().min(1).optional(), status: z.string().optional(), amount: z.number().int().nonnegative().optional(), currency: z.string().optional() }).passthrough() }).passthrough();

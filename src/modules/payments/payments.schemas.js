import { z } from "zod";
export const initializePaymentSchema = z.object({ bookingType: z.enum(["PARCEL", "RIDE"]), bookingId: z.string().trim().min(1).max(128) }).strict();

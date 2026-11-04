import {z} from "zod";
export const refundRequestSchema=z.object({paymentAttemptId:z.string().trim().min(1).max(128),amountMinor:z.string().regex(/^[1-9][0-9]{0,14}$/),reason:z.string().trim().min(10).max(1000)}).strict();
export const reviewRefundSchema=z.object({decision:z.enum(["APPROVE","REJECT"]),reviewNote:z.string().trim().min(5).max(1000)}).strict();

import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(5).max(1000);
const currency = z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase());
const amount = z.string().regex(/^[1-9][0-9]{0,14}$/);
const category = z.string().trim().min(1).max(80);
const weight = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const driverPayoutListSchema = z.object({
  serviceZoneId: id.optional(),
  legType: z.enum(["LOCAL_PICKUP", "FINAL_MILE"]).optional(),
  parcelCategory: category.optional(),
  currency: currency.optional(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]).optional(),
}).strict();

export const driverPayoutRuleSchema = z.object({
  serviceZoneId: id,
  legType: z.enum(["LOCAL_PICKUP", "FINAL_MILE"]),
  parcelCategory: category,
  minWeightGrams: weight,
  maxWeightGrams: weight.nullable().optional(),
  currency: currency.default("NGN"),
  driverPayoutMinor: amount,
  effectiveFrom: z.coerce.date().default(() => new Date()),
  effectiveUntil: z.coerce.date().nullable().optional(),
  reason,
}).strict().superRefine((value, ctx) => {
  if (value.maxWeightGrams != null && value.maxWeightGrams <= value.minWeightGrams) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxWeightGrams"], message: "maxWeightGrams must be greater than minWeightGrams." });
  }
  if (value.effectiveUntil && value.effectiveUntil <= value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveUntil"], message: "effectiveUntil must be later than effectiveFrom." });
  }
});

export const driverPayoutRuleIdSchema = z.object({ ruleId: id }).strict();
export const driverPayoutReasonSchema = z.object({ reason }).strict();

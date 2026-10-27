import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";

const refundSchema = z.object({
  bookingType: z.enum(["PASSENGER_RIDE", "PARCEL_DELIVERY"]),
  bookingId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const payoutSchema = z.object({
  bookingType: z.enum(["PASSENGER_RIDE", "PARCEL_DELIVERY"]),
  bookingId: z.string().trim().min(1).max(128),
}).strict();
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

function parse(schema, value, message) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(message, parsed.error.issues.map(({ path, message: issue }) => ({ path: path.join("."), message: issue })));
  return parsed.data;
}
function validateBody(schema, message, requireKey = false) {
  return (req, _res, next) => {
    try {
      const body = parse(schema, req.body, message);
      const key = req.get("Idempotency-Key");
      if (requireKey && (typeof key !== "string" || !idempotencyPattern.test(key))) {
        throw new ValidationError("A valid Idempotency-Key header is required.", [{ path: "Idempotency-Key", message: "Use 8-128 letters, numbers, periods, underscores, colons or hyphens." }]);
      }
      req.validated = { ...(req.validated ?? {}), body, ...(requireKey ? { idempotencyKey: key } : {}) };
      return next();
    } catch (error) { return next(error); }
  };
}
export const validateRefundRequest = validateBody(refundSchema, "The refund request is invalid.", true);
export const validatePayoutRequest = validateBody(payoutSchema, "The payout request is invalid.", true);

export function validateRefundId(req, _res, next) {
  const parsed = z.string().trim().min(1).max(128).safeParse(req.params.refundId);
  if (!parsed.success) return next(new ValidationError("The refund ID is invalid."));
  req.validated = { ...(req.validated ?? {}), params: { refundId: parsed.data } };
  return next();
}
export function validateFinancialList(req, _res, next) {
  const schema = z.object({
    status: z.enum(["REQUESTED", "PROCESSING", "SUCCEEDED", "FAILED", "REJECTED", "PENDING", "ELIGIBLE", "PAID"]).optional(),
    cursor: z.string().trim().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).strict();
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return next(new ValidationError("The financial list query is invalid."));
  req.validated = { ...(req.validated ?? {}), query: parsed.data };
  return next();
}
export function validatePaymentReference(req, _res, next) {
  const parsed = z.string().trim().min(1).max(128).safeParse(req.params.reference);
  if (!parsed.success) return next(new ValidationError("The payment reference is invalid."));
  req.validated = { ...(req.validated ?? {}), params: { reference: parsed.data } };
  return next();
}

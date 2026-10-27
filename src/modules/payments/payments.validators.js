import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";

const initializeSchema = z.object({
  serviceType: z.enum(["PASSENGER_RIDE", "PARCEL_DELIVERY"]),
  bookingId: z.string().trim().min(1).max(128),
}).strict();

export function validatePaymentInitialization(req, _res, next) {
  const parsed = initializeSchema.safeParse(req.body);
  if (!parsed.success) return next(new ValidationError("The payment initialization request is invalid.", parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message }))));
  const key = req.get("Idempotency-Key");
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return next(new ValidationError("A valid Idempotency-Key header is required.", [{ path: "Idempotency-Key", message: "Use 8-128 letters, numbers, periods, underscores, colons or hyphens." }]));
  }
  req.validated = { ...(req.validated ?? {}), body: parsed.data, idempotencyKey: key };
  return next();
}

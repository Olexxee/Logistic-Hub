import { createRideBookingSchema, rideIdempotencyKeySchema } from "./ride-bookings.schemas.js";
import { ValidationError } from "../../shared/http/app-error.js";

export function validateCreateRideBooking(req, _res, next) {
  const body = createRideBookingSchema.safeParse(req.body);
  if (!body.success) {
    return next(new ValidationError("The ride booking request is invalid.", body.error.issues.map(({ path, message }) => ({ path: path.join("."), message }))));
  }
  const key = rideIdempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
  if (!key.success) {
    return next(new ValidationError("A valid Idempotency-Key header is required.", [
      { path: "Idempotency-Key", message: "Use 8-128 letters, numbers, periods, underscores, colons or hyphens." },
    ]));
  }
  req.validated = { ...(req.validated ?? {}), body: body.data, idempotencyKey: key.data };
  return next();
}

export function validateRideBookingId(req, _res, next) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.rideBookingId ?? "")) {
    return next(new ValidationError("The ride booking ID is invalid."));
  }
  req.validated = { ...(req.validated ?? {}), params: { ...(req.validated?.params ?? {}), rideBookingId: req.params.rideBookingId } };
  return next();
}

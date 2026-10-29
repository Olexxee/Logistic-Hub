import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";
import { acceptFareSchema, proposeFareSchema } from "../dispatch/dispatch.schemas.js";

const idSchema = z.string().trim().min(1).max(128);
function validate(req, next, { key, value, schema, message }) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return next(new ValidationError(message ?? "One or more fields are invalid.", parsed.error.issues.map(({ path, message: issue }) => ({ path: path.join("."), message: issue }))));
  req.validated = { ...(req.validated ?? {}), [key]: parsed.data };
  return next();
}
export function validateRideBookingId(req, _res, next) {
  return validate(req, next, { key: "params", value: { rideBookingId: req.params.rideBookingId }, schema: z.object({ rideBookingId: idSchema }), message: "The ride booking ID is invalid." });
}
export function validateRideOfferId(req, _res, next) {
  return validate(req, next, { key: "params", value: { offerId: req.params.offerId }, schema: z.object({ offerId: idSchema }), message: "The driver offer ID is invalid." });
}
export function validateProposeRideFare(req, _res, next) {
  return validate(req, next, { key: "body", value: req.body, schema: proposeFareSchema });
}
export function validateAcceptRideFare(req, _res, next) {
  return validate(req, next, { key: "body", value: req.body, schema: acceptFareSchema });
}
export function validateRideDispatchIdempotencyKey(req, _res, next) {
  return validate(req, next, { key: "idempotencyKey", value: req.get("Idempotency-Key"), schema: idempotencyKeySchema, message: "A valid Idempotency-Key header is required." });
}

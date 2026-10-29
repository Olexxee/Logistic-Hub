import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";
import { acceptFareSchema, proposeFareSchema } from "./dispatch.schemas.js";

const idSchema = z.string().trim().min(1).max(128);

function validate(req, next, values) {
  const parsed = values.schema.safeParse(values.value);
  if (!parsed.success) {
    return next(new ValidationError(
      values.message ?? "One or more fields are invalid.",
      parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
    ));
  }
  req.validated = { ...(req.validated ?? {}), [values.key]: parsed.data };
  return next();
}

export function validateDispatchBookingId(req, _res, next) {
  return validate(req, next, { key: "params", value: { bookingId: req.params.bookingId }, schema: z.object({ bookingId: idSchema }), message: "The parcel booking ID is invalid." });
}
export function validateDispatchOfferId(req, _res, next) {
  return validate(req, next, { key: "params", value: { offerId: req.params.offerId }, schema: z.object({ offerId: idSchema }), message: "The driver offer ID is invalid." });
}
export function validateProposeParcelFare(req, _res, next) {
  return validate(req, next, { key: "body", value: req.body, schema: proposeFareSchema });
}
export function validateAcceptParcelFare(req, _res, next) {
  return validate(req, next, { key: "body", value: req.body, schema: acceptFareSchema });
}
export function validateDispatchIdempotencyKey(req, _res, next) {
  return validate(req, next, { key: "idempotencyKey", value: req.get("Idempotency-Key"), schema: idempotencyKeySchema, message: "A valid Idempotency-Key header is required." });
}

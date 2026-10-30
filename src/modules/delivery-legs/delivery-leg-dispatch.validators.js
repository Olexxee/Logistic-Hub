import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";

const id = z.string().trim().min(1).max(128);
const schemas = {
  params: {
    legId: z.object({ legId: id }),
    offerId: z.object({ offerId: id }),
    bookingLeg: z.object({ bookingId: id, legId: id }),
  },
  proposeFare: z.object({ proposedFareMinor: z.string().regex(/^[1-9][0-9]{0,14}$/) }).strict(),
  acceptFare: z.object({ offerId: id }).strict(),
};

function validate(schema, source, key, message) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(source === "header" ? req.get("Idempotency-Key") : req[source]);
    if (!parsed.success) {
      return next(new ValidationError(
        message ?? "One or more fields are invalid.",
        parsed.error.issues.map(({ path, message: issueMessage }) => ({ path: path.join("."), message: issueMessage })),
      ));
    }
    if (source === "header") req.validated = { ...(req.validated ?? {}), idempotencyKey: parsed.data };
    else req.validated = { ...(req.validated ?? {}), [key]: parsed.data };
    return next();
  };
}

export const validateLegId = validate(schemas.params.legId, "params", "params", "The delivery leg ID is invalid.");
export const validateOfferId = validate(schemas.params.offerId, "params", "params", "The delivery-leg offer ID is invalid.");
export const validateBookingLegIds = validate(schemas.params.bookingLeg, "params", "params", "The booking or delivery leg ID is invalid.");
export const validateLegFareProposal = validate(schemas.proposeFare, "body", "body");
export const validateLegFareAcceptance = validate(schemas.acceptFare, "body", "body");
export const validateLegIdempotencyKey = validate(idempotencyKeySchema, "header", "idempotencyKey", "A valid Idempotency-Key header is required.");

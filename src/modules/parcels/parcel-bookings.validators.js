import { z } from "zod";
import { createParcelBookingSchema, idempotencyKeySchema } from "./parcel-bookings.schemas.js";
import { ValidationError } from "../../shared/http/app-error.js";

const bookingStatuses = [
  "DRAFT", "MATCHING", "AWAITING_CUSTOMER_ACCEPTANCE", "AWAITING_PAYMENT",
  "PAYMENT_PENDING", "DRIVER_ASSIGNED", "PICKUP_VERIFICATION_PENDING",
  "PICKED_UP", "IN_TRANSIT", "DELIVERY_VERIFICATION_PENDING", "COMPLETED",
  "CANCELLATION_PENDING", "CANCELLED", "FAILED",
];

const listParcelBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(bookingStatuses).optional(),
  paymentStatus: z.enum(["INITIALIZED", "PENDING", "SUCCEEDED", "FAILED", "ABANDONED", "REVERSED"]).optional(),
  reference: z.string().trim().min(2).max(64).optional(),
  pickupServiceZoneId: z.string().trim().min(1).max(128).optional(),
  destinationServiceZoneId: z.string().trim().min(1).max(128).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
}).strict().refine(value => !value.createdFrom || !value.createdTo || new Date(value.createdFrom) <= new Date(value.createdTo), {
  message: "createdFrom must be earlier than or equal to createdTo.",
  path: ["createdTo"],
});

export function validateListParcelBookings(req, _res, next) {
  const parsed = listParcelBookingsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ValidationError(
      "The parcel booking list query is invalid.",
      parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
    ));
  }
  req.validated = { ...(req.validated ?? {}), query: parsed.data };
  return next();
}

export function validateCreateParcelBooking(req, _res, next) {
  const body = createParcelBookingSchema.safeParse(req.body);
  if (!body.success) return next(new ValidationError("The parcel booking request is invalid.", body.error.issues.map(({ path, message }) => ({ path: path.join("."), message }))));
  const key = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
  if (!key.success) return next(new ValidationError("A valid Idempotency-Key header is required.", [{ path: "Idempotency-Key", message: "Use 8-128 letters, numbers, periods, underscores, colons or hyphens." }]));
  req.validated = { ...(req.validated ?? {}), body: body.data, idempotencyKey: key.data };
  return next();
}
export function validateParcelBookingId(req, _res, next) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.bookingId ?? "")) return next(new ValidationError("The booking ID is invalid."));
  req.validated = { ...(req.validated ?? {}), params: { bookingId: req.params.bookingId } };
  return next();
}

export function validateCustomerQuoteParams(req, _res, next) {
  const validId = value => /^[A-Za-z0-9_-]{1,128}$/.test(value ?? "");
  if (!validId(req.params.bookingId) || (req.params.quoteId && !validId(req.params.quoteId))) {
    return next(new ValidationError("The booking or quote ID is invalid."));
  }
  req.validated = { ...(req.validated ?? {}), params: { bookingId: req.params.bookingId, ...(req.params.quoteId ? { quoteId: req.params.quoteId } : {}) } };
  return next();
}
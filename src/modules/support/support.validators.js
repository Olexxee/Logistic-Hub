import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";

const createSchema = z.object({
  category: z.enum(["GENERAL", "PAYMENT", "DRIVER", "DELIVERY", "CANCELLATION_REFUND", "SAFETY", "OTHER"]),
  subject: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(5000),
  bookingType: z.enum(["PASSENGER_RIDE", "PARCEL_DELIVERY"]).optional(),
  bookingId: z.string().trim().min(1).max(128).optional(),
}).strict().refine((v) => Boolean(v.bookingType) === Boolean(v.bookingId), { message: "bookingType and bookingId must be supplied together." });
const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().trim().min(1).max(128).nullable().optional(),
  resolution: z.string().trim().min(3).max(5000).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: "At least one field is required." });
const cancelSchema = z.object({ reason: z.string().trim().min(5).max(1000) }).strict();

function parse(schema, value, message) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(message, result.error.issues.map(({ path, message: issue }) => ({ path: path.join("."), message: issue })));
  return result.data;
}
export function validateCreateSupportTicket(req, _res, next) {
  try { req.validated = { ...(req.validated ?? {}), body: parse(createSchema, req.body, "The support ticket request is invalid.") }; return next(); }
  catch (error) { return next(error); }
}
export function validateSupportTicketUpdate(req, _res, next) {
  try {
    req.validated = { ...(req.validated ?? {}), params: { ticketId: req.params.ticketId }, body: parse(updateSchema, req.body, "The support ticket update is invalid.") };
    return next();
  } catch (error) { return next(error); }
}
export function validateCancelBooking(req, _res, next) {
  try {
    const bookingType = req.path.startsWith("/ride-bookings/") ? "PASSENGER_RIDE" : "PARCEL_DELIVERY";
    req.validated = { ...(req.validated ?? {}), params: { bookingId: req.params.bookingId }, body: parse(cancelSchema, req.body, "The cancellation request is invalid."), bookingType };
    return next();
  } catch (error) { return next(error); }
}

export function validateSupportListQuery(req, _res, next) {
  const schema = z.object({
    status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    cursor: z.string().trim().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).strict();
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return next(new ValidationError("The support list query is invalid."));
  req.validated = { ...(req.validated ?? {}), query: parsed.data };
  return next();
}

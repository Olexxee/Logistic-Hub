import { Router } from "express";
import { z } from "zod";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createOperationalTripPricingService } from "./operational-trip-pricing.service.js";

const id = z.string().trim().min(1).max(128);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const leg = z.object({
  sequence: z.number().int().min(1).max(10),
  type: z.enum(["LOCAL_PICKUP", "INTERSTATE_TRANSPORT", "FINAL_MILE", "HUB_TRANSFER", "DIRECT"]),
  executionType: z.enum(["DRIVER", "PARTNER"]), customerChargeMinor: minor,
  driverPayoutMinor: minor.optional(), partnerId: id.optional(), agreementId: id.optional(), executionCostMinor: minor.optional(),
}).strict();
const inputSchema = z.object({
  reason: z.string().trim().min(5).max(500), expiresInMinutes: z.number().int().min(5).max(1440).default(60),
  legs: z.array(leg).min(1).max(10), collectionChargeMinor: minor.default("0"),
  hubHandlingChargeMinor: minor.default("0"), destinationDeliveryChargeMinor: minor.default("0"),
  platformChargeMinor: minor.default("0"), otherChargesMinor: minor.default("0"),
}).strict();
function validateId(req, res, next) {
  if (!id.safeParse(req.params.bookingId).success) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid booking identifier is required." } });
  next();
}
function validateBody(req, res, next) {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
    details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  } });
  req.body = parsed.data; next();
}
export function createOperationalTripPricingRouter({ prismaClient }) {
  const router = Router(), service = createOperationalTripPricingService({ prismaClient });
  router.get("/parcel-bookings/:bookingId/operational-plan", validateId, asyncWrapper(async (req, res) => {
    const result = await service.getPlan({ bookingId: req.params.bookingId });
    if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
    if (result.conflict) return res.status(409).json({ success: false, error: { code: "BOOKING_NOT_QUOTABLE", message: result.conflict } });
    if (result.unavailable) return res.status(409).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "The route zones or required hub facilities are not currently serviceable." } });
    return res.status(200).json({ success: true, data: result });
  }));
  router.get("/parcel-bookings/:bookingId/operational-quotes", validateId, asyncWrapper(async (req, res) => {
    const result = await service.listQuotes({ bookingId: req.params.bookingId });
    if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
    return res.status(200).json({ success: true, data: result });
  }));
  router.post("/parcel-bookings/:bookingId/operational-quotes", validateId, validateBody, asyncWrapper(async (req, res) => {
    const result = await service.issueQuote({ bookingId: req.params.bookingId, actorUserId: req.user.id, input: req.body });
    if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
    if (result.conflict) return res.status(409).json({ success: false, error: { code: "BOOKING_NOT_QUOTABLE", message: result.conflict } });
    if (result.unavailable) return res.status(409).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "The route zones are not active and available for parcel delivery." } });
    if (result.routeChanged) return res.status(409).json({ success: false, error: { code: "ROUTE_PLAN_CHANGED", message: "The submitted leg plan no longer matches the current backend route. Refresh the plan." } });
    if (result.hubIneligible) return res.status(409).json({ success: false, error: { code: "HUB_NOT_OPERATIONAL", message: "Every route hub must remain active and operator-verified." } });
    if (result.invalidExecution) return res.status(400).json({ success: false, error: { code: "INVALID_LEG_EXECUTION", message: "A driver leg must be a fixed-payout LOCAL_PICKUP; partner legs need a partner agreement and execution cost." } });
    if (result.multipleDriverLegs) return res.status(400).json({ success: false, error: { code: "MULTIPLE_DRIVER_LEGS_UNSUPPORTED", message: "Only one driver-executed leg is supported per booking until multi-driver payment allocation is implemented." } });
    if (result.driverLegRequired) return res.status(400).json({ success: false, error: { code: "DRIVER_LEG_REQUIRED", message: "The current payment flow requires one fixed-payout LOCAL_PICKUP driver leg. This route topology does not contain one." } });
    if (result.partnerIneligible) return res.status(409).json({ success: false, error: { code: "PARTNER_AGREEMENT_INELIGIBLE", message: "Every partner-executed leg requires an active agreement with an active, verified partner in the booking currency." } });
    if (result.invalidTotal) return res.status(400).json({ success: false, error: { code: "INVALID_CUSTOMER_TOTAL", message: "The consolidated customer total is outside the supported minor-unit range." } });
    return res.status(201).json({ success: true, data: result });
  }));
  return router;
}

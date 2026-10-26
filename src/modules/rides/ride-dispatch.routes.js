import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";
import { acceptFareSchema, listDriverOffersQuerySchema, proposeFareSchema } from "../dispatch/dispatch.schemas.js";
import { createRideDispatchService } from "./ride-dispatch.service.js";

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "One or more fields are invalid.", details: issues.map(({ path, message }) => ({ path: path.join("."), message })) },
  });
}
const idSchema = z.string().trim().min(1).max(128);

export function createRideDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createRideDispatchService({ prismaClient });
  const requireDriver = requireRole("DRIVER");

  router.post("/ride-bookings/:rideBookingId/request-matching", requireAuth, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.rideBookingId);
    if (!id.success) return validationError(res, id.error.issues);
    try {
      const result = await service.requestMatching({ rideBookingId: id.data, user: req.user });
      return result
        ? res.status(202).json({ success: true, data: result })
        : res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ride booking not found." } });
    } catch (error) { return next(error); }
  });

  router.get("/ride-bookings/:rideBookingId/offers", requireAuth, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.rideBookingId);
    if (!id.success) return validationError(res, id.error.issues);
    try {
      const offers = await service.listPassengerOffers({ rideBookingId: id.data, user: req.user });
      return offers === null
        ? res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ride booking not found." } })
        : res.status(200).json({ success: true, data: offers });
    } catch (error) { return next(error); }
  });

  router.get("/driver/ride-offers", requireAuth, requireDriver, async (req, res, next) => {
    const query = listDriverOffersQuerySchema.safeParse(req.query);
    if (!query.success) return validationError(res, query.error.issues);
    try {
      const result = await service.listDriverOffers({ userId: req.user.id, ...query.data });
      return res.status(200).json({ success: true, data: result.data, page: { nextCursor: result.nextCursor } });
    } catch (error) { return next(error); }
  });

  router.post("/driver/ride-offers/:offerId/propose-fare", requireAuth, requireDriver, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.offerId);
    if (!id.success) return validationError(res, id.error.issues);
    const body = proposeFareSchema.safeParse(req.body);
    if (!body.success) return validationError(res, body.error.issues);
    const key = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!key.success) return validationError(res, [{ path: ["Idempotency-Key"], message: "A valid Idempotency-Key header is required." }]);
    try {
      const result = await service.proposeFare({ offerId: id.data, userId: req.user.id, proposedFareMinor: body.data.proposedFareMinor, idempotencyKey: key.data });
      return res.status(200).json({ success: true, data: result });
    } catch (error) { return next(error); }
  });

  router.post("/ride-bookings/:rideBookingId/accept-fare", requireAuth, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.rideBookingId);
    if (!id.success) return validationError(res, id.error.issues);
    const body = acceptFareSchema.safeParse(req.body);
    if (!body.success) return validationError(res, body.error.issues);
    const key = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!key.success) return validationError(res, [{ path: ["Idempotency-Key"], message: "A valid Idempotency-Key header is required." }]);
    try {
      const result = await service.acceptFare({ rideBookingId: id.data, user: req.user, offerId: body.data.offerId, idempotencyKey: key.data });
      return result
        ? res.status(200).json({ success: true, data: result })
        : res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ride booking not found." } });
    } catch (error) { return next(error); }
  });

  return router;
}
export const rideDispatchRouter = createRideDispatchRouter();

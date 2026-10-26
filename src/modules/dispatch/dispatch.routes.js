import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { createDispatchService } from "./dispatch.service.js";
import { acceptFareSchema, listDriverOffersQuerySchema, proposeFareSchema } from "./dispatch.schemas.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";

const idSchema = z.string().trim().min(1).max(128);

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "One or more fields are invalid.",
      details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
    },
  });
}

export function createDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createDispatchService({ prismaClient });

  router.post("/parcel-bookings/:bookingId/request-matching", async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.bookingId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    try {
      const result = await service.requestParcelMatching({ bookingId: parsedId.data, user: req.user });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The parcel booking was not found." } });
      return res.status(202).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/parcel-bookings/:bookingId/offers", async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.bookingId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    try {
      const offers = await service.listParcelOffers({ bookingId: parsedId.data, user: req.user });
      if (!offers) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The parcel booking was not found." } });
      return res.status(200).json({ success: true, data: offers });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/driver/offers", async (req, res, next) => {
    const parsed = listDriverOffersQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.listDriverOffers({ userId: req.user.id, ...parsed.data });
      return res.status(200).json({ success: true, data: result.data, page: { nextCursor: result.nextCursor } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/driver/offers/:offerId/propose-fare", async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.offerId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = proposeFareSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const idempotency = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!idempotency.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "A valid Idempotency-Key header is required." },
      });
    }
    try {
      const result = await service.proposeParcelFare({
        offerId: parsedId.data,
        userId: req.user.id,
        proposedFareMinor: parsed.data.proposedFareMinor,
        idempotencyKey: idempotency.data,
      });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({ success: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "The Idempotency-Key has already been used." } });
      }
      return next(error);
    }
  });

  router.post("/parcel-bookings/:bookingId/accept-fare", async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.bookingId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = acceptFareSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const idempotency = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!idempotency.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "A valid Idempotency-Key header is required." },
      });
    }
    try {
      const result = await service.acceptParcelFare({
        bookingId: parsedId.data,
        user: req.user,
        offerId: parsed.data.offerId,
        idempotencyKey: idempotency.data,
      });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The parcel booking was not found." } });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({ success: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "The Idempotency-Key has already been used." } });
      }
      return next(error);
    }
  });

  return router;
}

export const dispatchRouter = createDispatchRouter();

import { Router } from "express";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { createParcelBookingsService } from "./parcel-bookings.service.js";
import { createParcelBookingSchema, idempotencyKeySchema } from "./parcel-bookings.schemas.js";

export function createParcelBookingsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createParcelBookingsService({ prismaClient });

  router.post("/", async (req, res, next) => {
    const parsed = createParcelBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The parcel booking request is invalid.",
          details: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        },
      });
    }

    const idempotency = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!idempotency.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "A valid Idempotency-Key header is required.",
          details: [{ path: "Idempotency-Key", message: "Use 8-128 letters, numbers, periods, underscores, colons or hyphens." }],
        },
      });
    }

    try {
      const result = await service.createDraft({
        senderId: req.user.id,
        idempotencyKey: idempotency.data,
        input: parsed.data,
      });
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result.booking });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "The parcel booking request is invalid." },
        });
      }
      return next(error);
    }
  });

  router.get("/:bookingId", async (req, res, next) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.bookingId)) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "The booking ID is invalid." },
      });
    }
    try {
      const booking = await service.getVisibleBooking({ bookingId: req.params.bookingId, user: req.user });
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "The parcel booking was not found." },
        });
      }
      return res.status(200).json({ success: true, data: booking });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const parcelBookingsRouter = createParcelBookingsRouter();

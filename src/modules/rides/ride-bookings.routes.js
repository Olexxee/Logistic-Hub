import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { createRideBookingSchema, rideIdempotencyKeySchema } from "./ride-bookings.schemas.js";
import { createRideBookingsService } from "./ride-bookings.service.js";
import { createNotificationsService } from "../notifications/notifications.service.js";

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "One or more fields are invalid.", details: issues.map(({ path, message }) => ({ path: path.join("."), message })) },
  });
}

export function createRideBookingsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createRideBookingsService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });

  router.post("/", async (req, res, next) => {
    const parsed = createRideBookingSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const key = rideIdempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!key.success) return validationError(res, [{ path: ["Idempotency-Key"], message: "A valid Idempotency-Key header is required." }]);
    try {
      const result = await service.createDraft({ passengerId: req.user.id, idempotencyKey: key.data, input: parsed.data });
      if (!result.replay) {
        try {
          await notifications.createAndDeliver({
            userId: req.user.id,
            type: "RIDE_BOOKING_CREATED",
            title: "Ride booking created",
            body: `Your ride booking ${result.ride.publicReference} has been created. A driver fare must be accepted before payment is collected.`,
            data: { rideBookingId: result.ride.id, publicReference: result.ride.publicReference },
            deliveryKey: `ride-booking-created-${result.ride.id}`,
            emailSubject: "Your Logistic Hub ride booking was created",
          });
        } catch (notificationError) {
          req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not create ride booking notification");
        }
      }
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result.ride });
    } catch (error) { return next(error); }
  });

  router.get("/:rideBookingId", async (req, res, next) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.rideBookingId)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "The ride booking ID is invalid." } });
    }
    try {
      const ride = await service.getVisibleRide({ rideBookingId: req.params.rideBookingId, user: req.user });
      return ride
        ? res.status(200).json({ success: true, data: ride })
        : res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The ride booking was not found." } });
    } catch (error) { return next(error); }
  });

  return router;
}

export const rideBookingsRouter = createRideBookingsRouter();

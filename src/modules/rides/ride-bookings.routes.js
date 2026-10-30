import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { createRideBookingsService } from "./ride-bookings.service.js";
import { createRideBookingsController } from "./ride-bookings.controller.js";
import { validateCreateRideBooking, validateRideBookingId } from "./ride-bookings.validators.js";

export function createRideBookingsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createRideBookingsService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });
  const controller = createRideBookingsController({ service, notifications });

  router.post("/", requireAuth, validateCreateRideBooking, asyncWrapper(controller.create));
  router.get("/:rideBookingId", requireAuth, validateRideBookingId, asyncWrapper(controller.get));
  return router;
}

export const rideBookingsRouter = createRideBookingsRouter();

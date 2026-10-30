import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { createParcelBookingsService } from "./parcel-bookings.service.js";
import { createParcelBookingsController } from "./parcel-bookings.controller.js";
import { validateCreateParcelBooking, validateListParcelBookings, validateParcelBookingId } from "./parcel-bookings.validators.js";

export function createParcelBookingsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createParcelBookingsService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });
  const controller = createParcelBookingsController({ service, notifications });
  router.get("/", requireAuth, validateListParcelBookings, asyncWrapper(controller.list));
  router.post("/", requireAuth, validateCreateParcelBooking, asyncWrapper(controller.create));
  router.get("/:bookingId", requireAuth, validateParcelBookingId, asyncWrapper(controller.get));
  return router;
}
export const parcelBookingsRouter = createParcelBookingsRouter();

import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { createParcelBookingsService } from "./parcel-bookings.service.js";
import { createParcelBookingsController } from "./parcel-bookings.controller.js";
import { validateCreateParcelBooking, validateParcelBookingId } from "./parcel-bookings.validators.js";

export function createParcelBookingsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createParcelBookingsService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });
  const controller = createParcelBookingsController({ service, notifications });
  router.post("/", validateCreateParcelBooking, asyncWrapper(controller.create));
  router.get("/:bookingId", validateParcelBookingId, asyncWrapper(controller.get));
  return router;
}
export const parcelBookingsRouter = createParcelBookingsRouter();

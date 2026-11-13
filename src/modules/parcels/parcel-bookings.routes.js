import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { createParcelBookingsService } from "./parcel-bookings.service.js";
import { createCustomerShipmentQuotesService } from "./customer-shipment-quotes.service.js";
import { createParcelBookingsController } from "./parcel-bookings.controller.js";
import { validateCreateParcelBooking, validateListParcelBookings, validateParcelBookingId, validateCustomerQuoteParams } from "./parcel-bookings.validators.js";

export function createParcelBookingsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createParcelBookingsService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });
  const quoteService = createCustomerShipmentQuotesService({ prismaClient });
  const controller = createParcelBookingsController({ service, notifications, quoteService });
  router.get("/", requireAuth, validateListParcelBookings, asyncWrapper(controller.list));
  router.post("/", requireAuth, validateCreateParcelBooking, asyncWrapper(controller.create));
  router.post("/:bookingId/quotes", requireAuth, validateCustomerQuoteParams, asyncWrapper(controller.createQuote));
  router.get("/:bookingId/quotes", requireAuth, validateCustomerQuoteParams, asyncWrapper(controller.listQuotes));
  router.post("/:bookingId/quotes/:quoteId/accept", requireAuth, validateCustomerQuoteParams, asyncWrapper(controller.acceptQuote));
  router.post("/:bookingId/quotes/:quoteId/reject", requireAuth, validateCustomerQuoteParams, asyncWrapper(controller.rejectQuote));
  router.get("/:bookingId", requireAuth, validateParcelBookingId, asyncWrapper(controller.get));
  router.get("/:bookingId/delivery-legs", requireAuth, validateParcelBookingId, asyncWrapper(controller.listDeliveryLegs));
  return router;
}
export const parcelBookingsRouter = createParcelBookingsRouter();

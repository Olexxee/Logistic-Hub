import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createDispatchService } from "./dispatch.service.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { createDispatchNotificationsService } from "./dispatch-notifications.service.js";
import { createDispatchController } from "./dispatch.controller.js";
import {
  validateDispatchBookingId,
  validateDispatchOfferId,
  validateProposeParcelFare,
  validateAcceptParcelFare,
  validateDispatchIdempotencyKey,
} from "./dispatch.validators.js";

export function createDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createDispatchService({ prismaClient });
  const notificationDelivery = createNotificationsService({ prismaClient });
  const notifications = createDispatchNotificationsService({ prismaClient, notifications: notificationDelivery });
  const controller = createDispatchController({ service, notifications });
  const requireDriver = requireRole("DRIVER");

  router.post("/parcel-bookings/:bookingId/request-matching", requireAuth, validateDispatchBookingId, asyncWrapper(controller.requestMatching));
  router.get("/parcel-bookings/:bookingId/offers", requireAuth, validateDispatchBookingId, asyncWrapper(controller.listBookingOffers));
  router.get("/driver/offers", requireAuth, requireDriver, asyncWrapper(controller.listDriverOffers));
  router.post("/driver/offers/:offerId/propose-fare", requireAuth, requireDriver, validateDispatchOfferId, validateProposeParcelFare, validateDispatchIdempotencyKey, asyncWrapper(controller.proposeFare));
  router.post("/parcel-bookings/:bookingId/accept-fare", requireAuth, validateDispatchBookingId, validateAcceptParcelFare, validateDispatchIdempotencyKey, asyncWrapper(controller.acceptFare));

  return router;
}

export const dispatchRouter = createDispatchRouter();

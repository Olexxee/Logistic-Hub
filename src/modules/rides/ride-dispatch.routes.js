import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createRideDispatchService } from "./ride-dispatch.service.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { createRideDispatchNotificationsService } from "./ride-dispatch-notifications.service.js";
import { createRideDispatchController } from "./ride-dispatch.controller.js";
import {
  validateRideBookingId,
  validateRideOfferId,
  validateProposeRideFare,
  validateAcceptRideFare,
  validateRideDispatchIdempotencyKey,
} from "./ride-dispatch.validators.js";

export function createRideDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createRideDispatchService({ prismaClient });
  const notificationDelivery = createNotificationsService({ prismaClient });
  const notifications = createRideDispatchNotificationsService({ prismaClient, notifications: notificationDelivery });
  const controller = createRideDispatchController({ service, notifications });
  const requireDriver = requireRole("DRIVER");

  router.post("/ride-bookings/:rideBookingId/request-matching", requireAuth, validateRideBookingId, asyncWrapper(controller.requestMatching));
  router.get("/ride-bookings/:rideBookingId/offers", requireAuth, validateRideBookingId, asyncWrapper(controller.listBookingOffers));
  router.get("/driver/ride-offers", requireAuth, requireDriver, asyncWrapper(controller.listDriverOffers));
  router.post("/driver/ride-offers/:offerId/propose-fare", requireAuth, requireDriver, validateRideOfferId, validateProposeRideFare, validateRideDispatchIdempotencyKey, asyncWrapper(controller.proposeFare));
  router.post("/ride-bookings/:rideBookingId/accept-fare", requireAuth, validateRideBookingId, validateAcceptRideFare, validateRideDispatchIdempotencyKey, asyncWrapper(controller.acceptFare));

  return router;
}

export const rideDispatchRouter = createRideDispatchRouter();

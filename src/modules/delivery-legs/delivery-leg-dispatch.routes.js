import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createDeliveryLegDispatchService } from "./delivery-leg-dispatch.service.js";
import { createDeliveryLegDispatchController } from "./delivery-leg-dispatch.controller.js";
import {
  validateLegId, validateOfferId, validateBookingLegIds, validateHubDispatchParams,
  validateLegFareProposal, validateLegFareAcceptance, validateFixedPayoutAcceptance, validateLegIdempotencyKey,
} from "./delivery-leg-dispatch.validators.js";

export function createDeliveryLegDispatchRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
} = {}) {
  const router = Router();
  const service = createDeliveryLegDispatchService({ prismaClient });
  const controller = createDeliveryLegDispatchController(service);
  const requireDriver = roleMiddleware("DRIVER");

  router.post("/delivery-legs/:legId/request-matching", authMiddleware, validateLegId, asyncWrapper(controller.requestOffers));
  router.post("/hub-operations/hubs/:hubPointId/delivery-legs/:legId/request-matching", authMiddleware, validateHubDispatchParams, asyncWrapper(controller.requestOffersFromHub));
  router.get("/driver/delivery-leg-offers", authMiddleware, requireDriver, asyncWrapper(controller.listDriverOffers));
  router.post("/admin/delivery-legs/:legId/request-matching", authMiddleware, roleMiddleware("ADMIN"), validateLegId, asyncWrapper(controller.requestOffers));
  router.post("/driver/delivery-leg-offers/:offerId/accept-fixed-payout", authMiddleware, requireDriver, validateOfferId, validateFixedPayoutAcceptance, validateLegIdempotencyKey, asyncWrapper(controller.acceptFixedPayout));
  router.post("/driver/delivery-leg-offers/:offerId/propose-fare", authMiddleware, requireDriver, validateOfferId, validateLegFareProposal, validateLegIdempotencyKey, asyncWrapper(controller.proposeFare));
  router.get("/parcel-bookings/:bookingId/delivery-legs/:legId/offers", authMiddleware, validateBookingLegIds, asyncWrapper(controller.listCustomerOffers));
  router.post("/parcel-bookings/:bookingId/delivery-legs/:legId/accept-fare", authMiddleware, validateBookingLegIds, validateLegFareAcceptance, validateLegIdempotencyKey, asyncWrapper(controller.acceptFare));

  return router;
}

export const deliveryLegDispatchRouter = createDeliveryLegDispatchRouter();

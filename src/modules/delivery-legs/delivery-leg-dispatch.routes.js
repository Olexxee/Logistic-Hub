import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createDeliveryLegDispatchService } from "./delivery-leg-dispatch.service.js";
import { createDeliveryLegDispatchController } from "./delivery-leg-dispatch.controller.js";
import {
  validateLegId, validateOfferId, validateBookingLegIds, validateHubDispatchParams,
  validateLegFareProposal, validateLegFareAcceptance, validateLegIdempotencyKey,
} from "./delivery-leg-dispatch.validators.js";

export function createDeliveryLegDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createDeliveryLegDispatchService({ prismaClient });
  const controller = createDeliveryLegDispatchController(service);
  const requireDriver = requireRole("DRIVER");

  router.post("/delivery-legs/:legId/request-matching", requireAuth, validateLegId, asyncWrapper(controller.requestOffers));
  router.post("/hub-operations/hubs/:hubPointId/delivery-legs/:legId/request-matching", requireAuth, validateHubDispatchParams, asyncWrapper(controller.requestOffersFromHub));
  router.get("/driver/delivery-leg-offers", requireAuth, requireDriver, asyncWrapper(controller.listDriverOffers));
  router.post("/driver/delivery-leg-offers/:offerId/propose-fare", requireAuth, requireDriver, validateOfferId, validateLegFareProposal, validateLegIdempotencyKey, asyncWrapper(controller.proposeFare));
  router.get("/parcel-bookings/:bookingId/delivery-legs/:legId/offers", requireAuth, validateBookingLegIds, asyncWrapper(controller.listCustomerOffers));
  router.post("/parcel-bookings/:bookingId/delivery-legs/:legId/accept-fare", requireAuth, validateBookingLegIds, validateLegFareAcceptance, validateLegIdempotencyKey, asyncWrapper(controller.acceptFare));

  return router;
}

export const deliveryLegDispatchRouter = createDeliveryLegDispatchRouter();

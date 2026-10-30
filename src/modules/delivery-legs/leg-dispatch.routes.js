import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createLegDispatchService } from "./leg-dispatch.service.js";
import { createLegDispatchController } from "./leg-dispatch.controller.js";

const idParams = z.object({ legId: z.string().trim().min(1).max(128) });
const offerParams = z.object({ offerId: z.string().trim().min(1).max(128) });
const proposeFareBody = z.object({
  proposedFareMinor: z.string().regex(/^[1-9][0-9]{0,17}$/),
}).strict();
const acceptFareBody = z.object({ offerId: z.string().trim().min(1).max(128) }).strict();

function requireIdempotencyKey(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (!key || key.length < 16 || key.length > 128) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A 16–128 character Idempotency-Key header is required." } });
  }
  req.idempotencyKey = key;
  return next();
}

export function createLegDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const controller = createLegDispatchController(createLegDispatchService({ prismaClient }));
  router.post("/delivery-legs/:legId/request-matching", requireAuth, validate(idParams, "params"), controller.requestMatching);
  router.get("/delivery-legs/:legId/offers", requireAuth, validate(idParams, "params"), controller.listCustomerOffers);
  router.post("/delivery-legs/:legId/accept-fare", requireAuth, validate(idParams, "params"), requireIdempotencyKey, validate(acceptFareBody), controller.acceptFare);
  router.get("/driver/delivery-leg-offers", requireAuth, requireRole("DRIVER"), controller.listDriverOffers);
  router.post("/driver/delivery-leg-offers/:offerId/propose-fare", requireAuth, requireRole("DRIVER"), validate(offerParams, "params"), requireIdempotencyKey, validate(proposeFareBody), controller.proposeFare);
  return router;
}
export const legDispatchRouter = createLegDispatchRouter();

import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createSupportService } from "./support.service.js";
import { createSupportController } from "./support.controller.js";
import { validateCancelBooking, validateCreateSupportTicket, validateSupportTicketUpdate } from "./support.validators.js";

export function createSupportRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createSupportService({ prismaClient });
  const controller = createSupportController({ service });
  const requireSupport = requireRole("ADMIN", "SUPPORT");
  router.post("/tickets", requireAuth, validateCreateSupportTicket, asyncWrapper(controller.create));
  router.get("/tickets/mine", requireAuth, asyncWrapper(controller.mine));
  router.get("/tickets/admin", requireAuth, requireSupport, asyncWrapper(controller.adminList));
  router.patch("/tickets/admin/:ticketId", requireAuth, requireSupport, validateSupportTicketUpdate, asyncWrapper(controller.update));
  router.post("/ride-bookings/:bookingId/cancel", requireAuth, validateCancelBooking, asyncWrapper(controller.cancel));
  router.post("/parcel-bookings/:bookingId/cancel", requireAuth, validateCancelBooking, asyncWrapper(controller.cancel));
  return router;
}
export const supportRouter = createSupportRouter();

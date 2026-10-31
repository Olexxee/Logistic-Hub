import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createSupportService } from "./support.service.js";
import { createSupportController } from "./support.controller.js";
import { createTicketSchema, listTicketsQuerySchema, updateTicketSchema } from "./support.schemas.js";

export function createSupportRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  roleMiddleware = requireRole,
} = {}) {
  const router = Router();
  const controller = createSupportController(createSupportService({ prismaClient }));
  const ticketId = z.object({ ticketId: z.string().trim().min(1).max(128) });
  const supportAccess = roleMiddleware("ADMIN", "SUPPORT");

  router.post("/tickets", authMiddleware, validate(createTicketSchema), controller.create);
  router.get("/tickets/mine", authMiddleware, controller.mine);
  router.get("/admin/tickets", authMiddleware, supportAccess, validate(listTicketsQuerySchema, "query"), controller.adminList);
  router.patch(
    "/admin/tickets/:ticketId",
    authMiddleware,
    supportAccess,
    validate(ticketId, "params"),
    validate(updateTicketSchema),
    controller.update,
  );

  return router;
}

export const supportRouter = createSupportRouter();

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { validateRequest } from "../../shared/http/validate-request.js";
import { createSupportController } from "./support.controller.js";
import { createSupportService } from "./support.service.js";

const idSchema = z.object({ ticketId: z.string().trim().min(1).max(128) }).strict();
const createSchema = z.object({ category: z.enum(["BOOKING", "PAYMENT", "DRIVER", "REFUND", "ACCOUNT", "OTHER"]), subject: z.string().trim().min(5).max(160), bookingType: z.enum(["RIDE", "PARCEL"]).optional(), bookingId: z.string().trim().min(1).max(128).optional() }).strict();
const replySchema = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().optional().default(false) }).strict();
const updateSchema = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assignedAdminId: z.string().trim().min(1).max(128).nullable().optional() }).strict();
export function createSupportRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createSupportService({ prismaClient });
  const controller = createSupportController({ service });
  router.use(requireAuth);
  router.post("/", validateRequest(createSchema), controller.create);
  router.get("/", controller.list);
  router.get("/:ticketId", validateRequest(idSchema, "params"), controller.get);
  router.post("/:ticketId/messages", validateRequest(idSchema, "params"), validateRequest(replySchema), controller.reply);
  router.patch("/:ticketId", validateRequest(idSchema, "params"), validateRequest(updateSchema), controller.update);
  return router;
}
export const supportRouter = createSupportRouter();

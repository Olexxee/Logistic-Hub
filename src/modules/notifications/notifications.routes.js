import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { createNotificationsService } from "./notifications.service.js";
import { listNotificationsQuerySchema } from "./notifications.schemas.js";

const notificationIdSchema = z.string().trim().min(1).max(128);

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "One or more fields are invalid.",
      details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
    },
  });
}

export function createNotificationsRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createNotificationsService({ prismaClient });

  router.get("/", requireAuth, async (req, res, next) => {
    const parsed = listNotificationsQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.listForUser({ userId: req.user.id, ...parsed.data });
      return res.status(200).json({ success: true, data: result.data, page: { nextCursor: result.nextCursor }, unreadCount: result.unreadCount });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:notificationId/read", requireAuth, async (req, res, next) => {
    const parsedId = notificationIdSchema.safeParse(req.params.notificationId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    try {
      const notification = await service.markRead({ userId: req.user.id, notificationId: parsedId.data });
      if (!notification) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The notification was not found." } });
      }
      return res.status(200).json({ success: true, data: notification });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/read-all", requireAuth, async (req, res, next) => {
    try {
      const result = await service.markAllRead({ userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const notificationsRouter = createNotificationsRouter();

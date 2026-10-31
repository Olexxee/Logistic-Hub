import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { createMediaService } from "./media.service.js";
import { createMediaController } from "./media.controller.js";

export function createMediaRouter({ prismaClient = prisma, authMiddleware = requireAuth, service } = {}) {
  const router = Router();
  const controller = createMediaController(service ?? createMediaService({ prismaClient }));
  const params = z.object({ ticketId: z.string().trim().min(1).max(128) });
  const downloadParams = params.extend({ attachmentId: z.string().trim().min(1).max(128) });
  router.get("/tickets/:ticketId/attachments", authMiddleware, validate(params, "params"), controller.list);
  router.post(
    "/tickets/:ticketId/attachments",
    authMiddleware,
    validate(params, "params"),
    (req, res, next) => {
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/octet-stream") {
        return res.status(415).json({ success: false, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Upload evidence as application/octet-stream and provide x-file-content-type." } });
      }
      return next();
    },
    (req, res, next) => require("node:stream"),
    asyncWrapper(async (req, res, next) => next()),
  );
  router.post(
    "/tickets/:ticketId/attachments",
    authMiddleware,
    validate(params, "params"),
    (req, res, next) => {
      const parser = (awaitImportRawParser());
      return parser(req, res, next);
    },
    controller.upload,
  );
  router.get("/tickets/:ticketId/attachments/:attachmentId/download", authMiddleware, validate(downloadParams, "params"), controller.download);
  return router;
}

function awaitImportRawParser() {
  return rawParser;
}
import { raw as rawParser } from "express";
export const mediaRouter = createMediaRouter();

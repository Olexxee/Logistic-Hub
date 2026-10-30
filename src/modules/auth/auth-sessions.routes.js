import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { validate } from "../../shared/http/validate.js";
import { createAuthMiddleware } from "./auth.middleware.js";
import { createAuthSessionsService } from "./auth-sessions.service.js";

const tokenSchema = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();

export function createAuthSessionsRouter({ prismaClient = prisma, secret = env.JWT_ACCESS_SECRET } = {}) {
  const router = Router();
  const service = createAuthSessionsService({ prismaClient, secret });
  const { requireAuth } = createAuthMiddleware({ prismaClient, secret });
  router.post("/refresh", (_req, res) => res.status(410).json({ success: false, error: { code: "ENDPOINT_DEPRECATED", message: "Use POST /api/v1/auth/refresh. Refresh tokens are now managed by an HttpOnly cookie." } }));
  router.post("/revoke", validate(tokenSchema), asyncWrapper(async (req, res) => {
    const data = await service.revoke(req.body.refreshToken);
    res.status(200).json({ success: true, data });
  }));
  router.post("/revoke-all", requireAuth, asyncWrapper(async (req, res) => {
    const data = await service.revokeAll(req.user.id);
    res.status(200).json({ success: true, data });
  }));
  return router;
}
export const authSessionsRouter = createAuthSessionsRouter();

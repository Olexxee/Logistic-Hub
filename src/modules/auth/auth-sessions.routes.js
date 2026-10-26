import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "./auth.middleware.js";
import { createAuthSessionsController } from "./auth-sessions.controller.js";
import { createAuthSessionsService } from "./auth-sessions.service.js";
import { validateRequest } from "../../shared/http/validate-request.js";
import { persistentRateLimit } from "../../shared/http/persistent-rate-limit.js";

const refreshSchema = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();

export function createAuthSessionsRouter({ prismaClient = prisma, secret = env.JWT_ACCESS_SECRET } = {}) {
  const router = Router();
  const service = createAuthSessionsService({ prismaClient, secret });
  const controller = createAuthSessionsController({ service });
  router.post("/refresh", persistentRateLimit({ prismaClient, namespace: "auth-refresh", limit: 10, windowMs: 60_000, blockMs: 5 * 60_000 }), validateRequest(refreshSchema), controller.refresh);
  router.post("/revoke", requireAuth, validateRequest(refreshSchema), controller.revoke);
  return router;
}
export const authSessionsRouter = createAuthSessionsRouter();

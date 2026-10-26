import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "./async-wrapper.js";
import { TooManyRequestsError } from "./app-error.js";
import { createHash } from "node:crypto";

export function persistentRateLimit({
  prismaClient = prisma,
  namespace = "default",
  limit = 10,
  windowMs = 60_000,
  blockMs = windowMs,
  keyGenerator = (req) => req.ip ?? req.socket?.remoteAddress ?? "unknown",
  clock = () => new Date(),
} = {}) {
  return asyncWrapper(async (req, _res, next) => {
    const identity = String(keyGenerator(req) || "unknown");
    const key = createHash("sha256").update(`${namespace}:${identity}`).digest("hex");
    const now = clock();
    const resetAt = new Date(now.getTime() - windowMs);
    const blockedUntil = new Date(now.getTime() + blockMs);

    const result = await prismaClient.$transaction(async (tx) => {
      const existing = await tx.authRateLimitBucket.findUnique({ where: { key } });
      if (!existing || existing.windowStartedAt <= resetAt) {
        await tx.authRateLimitBucket.upsert({
          where: { key },
          create: { key, windowStartedAt: now, requestCount: 1, blockedUntil: null },
          update: { windowStartedAt: now, requestCount: 1, blockedUntil: null },
        });
        return { allowed: true, remaining: limit - 1 };
      }
      if (existing.blockedUntil && existing.blockedUntil > now) {
        return { allowed: false, retryAfterMs: existing.blockedUntil.getTime() - now.getTime() };
      }
      const updated = await tx.authRateLimitBucket.update({
        where: { key },
        data: {
          requestCount: { increment: 1 },
          ...(existing.requestCount + 1 >= limit ? { blockedUntil } : {}),
        },
      });
      return updated.requestCount > limit
        ? { allowed: false, retryAfterMs: blockMs }
        : { allowed: true, remaining: Math.max(0, limit - updated.requestCount) };
    });

    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.retryAfterMs ?? blockMs) / 1000));
      req.res?.setHeader?.("Retry-After", String(retryAfter));
      throw new TooManyRequestsError();
    }
    req.rateLimit = { remaining: result.remaining };
    return next();
  });
}

import { createHash } from "node:crypto";
import { createRateLimitRepository } from "./rate-limit.repository.js";
import { TooManyRequestsError } from "./app-error.js";

export function createPersistentRateLimit({ prismaClient, namespace = "api", limit = 60, windowMs = 60_000, keyFn } = {}) {
  const repository = createRateLimitRepository(prismaClient);
  return async (req, res, next) => {
    try {
      const rawKey = keyFn ? keyFn(req) : (req.user?.id ?? req.ip ?? req.socket?.remoteAddress ?? "unknown");
      const digest = createHash("sha256").update(String(rawKey)).digest("hex");
      const now = Date.now();
      const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
      const windowEndsAt = new Date(windowStartedAt.getTime() + windowMs);
      const result = await repository.consume({ key: `${namespace}:${digest}:${windowStartedAt.getTime()}`, windowStartedAt, windowEndsAt, limit });
      res.setHeader("RateLimit-Limit", String(limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        throw new TooManyRequestsError(undefined, result.retryAfterSeconds);
      }
      next();
    } catch (error) { next(error); }
  };
}

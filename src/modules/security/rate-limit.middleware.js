import { prisma } from "../../db/prisma.js";
import { createRateLimitRepository } from "./rate-limit.repository.js";

export function createPersistentRateLimit({
  prismaClient = prisma,
  namespace = "api",
  limit = 120,
  windowMs = 60_000,
  keyGenerator = (req) => req.ip ?? req.socket?.remoteAddress ?? "unknown",
  skip = () => false,
} = {}) {
  const repository = createRateLimitRepository({ prismaClient });
  return async function persistentRateLimit(req, res, next) {
    if (skip(req)) return next();
    try {
      const result = await repository.consume({
        namespace,
        identity: String(keyGenerator(req)),
        limit,
        windowMs,
      });
      res.setHeader("RateLimit-Limit", String(limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      res.setHeader("RateLimit-Reset", String(result.retryAfterSeconds));
      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        return res.status(429).json({
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
        });
      }
      return next();
    } catch (error) {
      // Fail closed for authentication and other abuse-sensitive namespaces.
      if (namespace.startsWith("auth")) {
        return res.status(503).json({
          success: false,
          error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Request protection is temporarily unavailable." },
        });
      }
      return next(error);
    }
  };
}

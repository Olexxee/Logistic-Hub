import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "./async-wrapper.js";
import { TooManyRequestsError } from "./app-error.js";
import { createPersistentRateLimitRepository } from "./persistent-rate-limit.repository.js";

export function persistentRateLimit({
  prismaClient = prisma,
  namespace = "default",
  limit = 10,
  windowMs = 60_000,
  blockMs = windowMs,
  keyGenerator = (req) => req.ip ?? req.socket?.remoteAddress ?? "unknown",
  clock = () => new Date(),
} = {}) {
  const repository = createPersistentRateLimitRepository({ prismaClient });
  return asyncWrapper(async (req, res, next) => {
    const identity = String(keyGenerator(req) || "unknown");
    const key = createHash("sha256").update(`${namespace}:${identity}`).digest("hex");
    const result = await repository.consume({ key, now: clock(), windowMs, limit, blockMs });
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.retryAfterMs ?? blockMs) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      throw new TooManyRequestsError();
    }
    req.rateLimit = { remaining: result.remaining };
    return next();
  });
}

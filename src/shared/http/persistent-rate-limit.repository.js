export function createPersistentRateLimitRepository({ prismaClient }) {
  return {
    consume({ key, now, windowMs, limit, blockMs }) {
      return prismaClient.$transaction(async (tx) => {
        const existing = await tx.authRateLimitBucket.findUnique({ where: { key } });
        if (!existing || existing.windowStartedAt.getTime() <= now.getTime() - windowMs) {
          await tx.authRateLimitBucket.upsert({
            where: { key },
            create: { key, windowStartedAt: now, requestCount: 1, blockedUntil: null },
            update: { windowStartedAt: now, requestCount: 1, blockedUntil: null },
          });
          return { allowed: true, remaining: Math.max(0, limit - 1) };
        }
        if (existing.blockedUntil && existing.blockedUntil > now) {
          return { allowed: false, retryAfterMs: existing.blockedUntil.getTime() - now.getTime() };
        }
        const requestCount = existing.requestCount + 1;
        await tx.authRateLimitBucket.update({
          where: { key },
          data: { requestCount, ...(requestCount >= limit ? { blockedUntil: new Date(now.getTime() + blockMs) } : {}) },
        });
        return requestCount > limit
          ? { allowed: false, retryAfterMs: blockMs }
          : { allowed: true, remaining: Math.max(0, limit - requestCount) };
      });
    },
  };
}

import { prisma } from "../../db/prisma.js";

export function createRateLimitRepository(prismaClient = prisma) {
  return {
    consume({ key, windowStartedAt, windowEndsAt, limit }) {
      return prismaClient.$transaction(async (tx) => {
        const current = await tx.rateLimitBucket.findUnique({ where: { key } });
        if (!current || current.windowEndsAt <= windowStartedAt) {
          await tx.rateLimitBucket.upsert({
            where: { key },
            create: { key, count: 1, windowStartedAt, windowEndsAt },
            update: { count: 1, windowStartedAt, windowEndsAt },
          });
          return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: Math.ceil((windowEndsAt - windowStartedAt) / 1000) };
        }
        if (current.count >= limit) {
          return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.windowEndsAt - windowStartedAt) / 1000)) };
        }
        const changed = await tx.rateLimitBucket.updateMany({
          where: { key, count: current.count, windowEndsAt: current.windowEndsAt },
          data: { count: { increment: 1 } },
        });
        if (changed.count !== 1) {
          const latest = await tx.rateLimitBucket.findUnique({ where: { key } });
          return { allowed: Boolean(latest && latest.count < limit), remaining: Math.max(0, limit - (latest?.count ?? limit)), retryAfterSeconds: Math.max(1, Math.ceil(((latest?.windowEndsAt ?? windowEndsAt) - windowStartedAt) / 1000)) };
        }
        return { allowed: true, remaining: Math.max(0, limit - current.count - 1), retryAfterSeconds: Math.ceil((current.windowEndsAt - windowStartedAt) / 1000) };
      });
    },
  };
}

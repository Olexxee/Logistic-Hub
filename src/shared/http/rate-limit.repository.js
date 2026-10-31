import { prisma } from "../../db/prisma.js";

export function createRateLimitRepository(prismaClient = prisma) {
  return {
    async consume({ key, windowStartedAt, windowEndsAt, limit }) {
      const rows = await prismaClient.$queryRaw`
        INSERT INTO "rate_limit_buckets" AS bucket
          ("key", "count", "windowStartedAt", "windowEndsAt", "updatedAt")
        VALUES
          (${key}, 1, ${windowStartedAt}, ${windowEndsAt}, CURRENT_TIMESTAMP)
        ON CONFLICT ("key") DO UPDATE
        SET
          "count" = CASE
            WHEN bucket."windowEndsAt" <= EXCLUDED."windowStartedAt" THEN 1
            ELSE bucket."count" + 1
          END,
          "windowStartedAt" = CASE
            WHEN bucket."windowEndsAt" <= EXCLUDED."windowStartedAt" THEN EXCLUDED."windowStartedAt"
            ELSE bucket."windowStartedAt"
          END,
          "windowEndsAt" = CASE
            WHEN bucket."windowEndsAt" <= EXCLUDED."windowStartedAt" THEN EXCLUDED."windowEndsAt"
            ELSE bucket."windowEndsAt"
          END,
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "count", "windowEndsAt"
      `;

      const bucket = rows[0];
      if (!bucket) {
        throw new Error("Rate limit bucket upsert did not return a row");
      }

      const count = Number(bucket.count);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((new Date(bucket.windowEndsAt).getTime() - Date.now()) / 1000),
      );

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds,
      };
    },
  };
}

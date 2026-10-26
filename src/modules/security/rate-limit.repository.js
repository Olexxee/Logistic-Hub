import { createHash } from "node:crypto";

export function createRateLimitRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    async consume({ namespace, identity, limit, windowMs, now = new Date() }) {
      const key = createHash("sha256").update(`${namespace}: ${identity}`).digest("hex");
      const expiresAt = new Date(now.getTime() + windowMs);
      const rows = await prismaClient.$queryRaw`
        INSERT INTO rate_limit_buckets ("key", "window_started_at", "request_count", "expires_at", "updated_at")
        VALUES (${key}, ${now}, 1, ${expiresAt}, ${now})
        ON CONFLICT ("key") DO UPDATE SET
          "window_started_at" = CASE
            WHEN rate_limit_buckets."expires_at" <= ${now} THEN ${now}
            ELSE rate_limit_buckets."window_started_at"
          END,
          "request_count" = CASE
            WHEN rate_limit_buckets."expires_at" <= ${now} THEN 1
            ELSE rate_limit_buckets."request_count" + 1
          END,
          "expires_at" = CASE
            WHEN rate_limit_buckets."expires_at" <= ${now} THEN ${expiresAt}
            ELSE rate_limit_buckets."expires_at"
          END,
          "updated_at" = ${now}
        RETURNING "request_count" AS count, "expires_at" AS "expiresAt"
      `;
      const row = rows[0];
      return {
        allowed: Number(row.count) <= limit,
        remaining: Math.max(0, limit - Number(row.count)),
        retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.expiresAt).getTime() - now.getTime()) / 1000)),
      };
    },
  };
}

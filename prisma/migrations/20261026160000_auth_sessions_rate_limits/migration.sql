CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "rotatedFromId" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_sessions_refreshTokenHash_key" ON "auth_sessions"("refreshTokenHash");
CREATE INDEX "auth_sessions_userId_revokedAt_expiresAt_idx" ON "auth_sessions"("userId", "revokedAt", "expiresAt");
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "auth_rate_limit_buckets" (
  "key" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_rate_limit_buckets_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "auth_rate_limit_buckets_blockedUntil_idx" ON "auth_rate_limit_buckets"("blockedUntil");
CREATE INDEX "auth_rate_limit_buckets_updatedAt_idx" ON "auth_rate_limit_buckets"("updatedAt");

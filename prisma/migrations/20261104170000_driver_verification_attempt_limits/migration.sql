ALTER TABLE "verification_tokens"
ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;

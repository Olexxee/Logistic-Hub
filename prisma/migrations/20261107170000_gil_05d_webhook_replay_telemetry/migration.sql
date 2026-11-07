ALTER TABLE "integration_webhook_deliveries"
  ADD COLUMN "totalAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "replayCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "integration_webhook_deliveries"
SET "totalAttempts" = "attempts";

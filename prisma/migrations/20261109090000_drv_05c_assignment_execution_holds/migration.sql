ALTER TABLE "driver_assignments"
  ADD COLUMN "executionHoldAt" TIMESTAMP(3),
  ADD COLUMN "executionHoldReason" TEXT,
  ADD COLUMN "executionHoldActorUserId" TEXT,
  ADD COLUMN "executionHoldOperationalCaseId" TEXT;

CREATE INDEX "driver_assignments_executionHoldAt_idx"
  ON "driver_assignments"("executionHoldAt");

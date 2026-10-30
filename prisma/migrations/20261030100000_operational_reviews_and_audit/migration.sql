ALTER TABLE "driver_profiles" ADD COLUMN "suspendedAt" TIMESTAMP(3), ADD COLUMN "suspensionReason" TEXT, ADD COLUMN "reinstatedAt" TIMESTAMP(3);
ALTER TABLE "hub_points" ADD COLUMN "operatorVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED', ADD COLUMN "operatorVerifiedAt" TIMESTAMP(3), ADD COLUMN "operatorVerificationNotes" TEXT;
CREATE TABLE "operational_audit_events" ("id" TEXT NOT NULL, "actorUserId" TEXT, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "action" TEXT NOT NULL, "reason" TEXT, "before" JSONB, "after" JSONB, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "operational_audit_events_pkey" PRIMARY KEY ("id"));
CREATE INDEX "operational_audit_events_entityType_entityId_createdAt_idx" ON "operational_audit_events"("entityType", "entityId", "createdAt");
CREATE INDEX "operational_audit_events_actorUserId_createdAt_idx" ON "operational_audit_events"("actorUserId", "createdAt");
ALTER TABLE "operational_audit_events" ADD CONSTRAINT "operational_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

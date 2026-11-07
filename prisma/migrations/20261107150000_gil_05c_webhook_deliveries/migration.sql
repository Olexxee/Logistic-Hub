CREATE TABLE "integration_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "secretVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastHttpStatus" INTEGER,
  "lastErrorCode" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_webhook_deliveries_eventId_endpointId_key"
  ON "integration_webhook_deliveries"("eventId", "endpointId");
CREATE INDEX "integration_webhook_deliveries_status_availableAt_createdAt_idx"
  ON "integration_webhook_deliveries"("status", "availableAt", "createdAt");
CREATE INDEX "integration_webhook_deliveries_status_lockedAt_idx"
  ON "integration_webhook_deliveries"("status", "lockedAt");
CREATE INDEX "integration_webhook_deliveries_endpointId_status_createdAt_idx"
  ON "integration_webhook_deliveries"("endpointId", "status", "createdAt");

ALTER TABLE "integration_webhook_deliveries"
  ADD CONSTRAINT "integration_webhook_deliveries_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "integration_shipment_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_webhook_deliveries"
  ADD CONSTRAINT "integration_webhook_deliveries_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "integration_webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_webhook_deliveries"
  ADD CONSTRAINT "integration_webhook_deliveries_endpoint_secret_version_fkey"
  FOREIGN KEY ("endpointId", "secretVersion")
  REFERENCES "integration_webhook_secret_versions"("endpointId", "version")
  ON DELETE RESTRICT ON UPDATE CASCADE;

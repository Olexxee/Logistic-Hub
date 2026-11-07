CREATE TYPE "IntegrationWebhookEndpointStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

CREATE TABLE "integration_webhook_endpoints" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "description" TEXT,
  "eventTypes" TEXT[] NOT NULL,
  "status" "IntegrationWebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentSecretVersion" INTEGER NOT NULL DEFAULT 1,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_webhook_secret_versions" (
  "id" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_webhook_secret_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_webhook_audit_events" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "endpointId" TEXT,
  "actorCredentialId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_webhook_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_webhook_endpoints_clientId_url_key"
  ON "integration_webhook_endpoints"("clientId", "url");
CREATE INDEX "integration_webhook_endpoints_clientId_status_createdAt_idx"
  ON "integration_webhook_endpoints"("clientId", "status", "createdAt");
CREATE UNIQUE INDEX "integration_webhook_secret_versions_endpointId_version_key"
  ON "integration_webhook_secret_versions"("endpointId", "version");
CREATE INDEX "integration_webhook_secret_versions_endpointId_createdAt_idx"
  ON "integration_webhook_secret_versions"("endpointId", "createdAt");
CREATE INDEX "integration_webhook_audit_events_clientId_createdAt_idx"
  ON "integration_webhook_audit_events"("clientId", "createdAt");
CREATE INDEX "integration_webhook_audit_events_endpointId_createdAt_idx"
  ON "integration_webhook_audit_events"("endpointId", "createdAt");

ALTER TABLE "integration_webhook_endpoints"
  ADD CONSTRAINT "integration_webhook_endpoints_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_webhook_secret_versions"
  ADD CONSTRAINT "integration_webhook_secret_versions_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "integration_webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_webhook_audit_events"
  ADD CONSTRAINT "integration_webhook_audit_events_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_webhook_audit_events"
  ADD CONSTRAINT "integration_webhook_audit_events_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "integration_webhook_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_webhook_audit_events"
  ADD CONSTRAINT "integration_webhook_audit_events_actorCredentialId_fkey"
  FOREIGN KEY ("actorCredentialId") REFERENCES "integration_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

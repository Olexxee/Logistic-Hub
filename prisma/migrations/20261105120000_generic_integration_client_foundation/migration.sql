-- Generic third-party integration client registry and commercial boundaries.
CREATE TYPE "IntegrationClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "IntegrationCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "IntegrationBillingModel" AS ENUM ('PLATFORM_COLLECTED', 'LOGISTIC_HUB_COLLECTED', 'PREPAID_ACCOUNT', 'INVOICE');
CREATE TYPE "IntegrationAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');

CREATE TABLE "integration_clients" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "IntegrationClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_clients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_clients_code_key" ON "integration_clients"("code");
CREATE INDEX "integration_clients_status_createdAt_idx" ON "integration_clients"("status", "createdAt");

CREATE TABLE "integration_credentials" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "keyId" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL, "label" TEXT NOT NULL,
  "status" "IntegrationCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_credentials_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integration_credentials_keyId_key" ON "integration_credentials"("keyId");
CREATE INDEX "integration_credentials_clientId_status_idx" ON "integration_credentials"("clientId", "status");
CREATE INDEX "integration_credentials_expiresAt_status_idx" ON "integration_credentials"("expiresAt", "status");

CREATE TABLE "integration_billing_agreements" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "reference" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "status" "IntegrationAgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "billingModel" "IntegrationBillingModel" NOT NULL, "currency" TEXT NOT NULL DEFAULT 'NGN',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3), "terms" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_billing_agreements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_billing_agreements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_billing_agreements_valid_dates" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);
CREATE UNIQUE INDEX "integration_billing_agreements_clientId_reference_version_key" ON "integration_billing_agreements"("clientId", "reference", "version");
CREATE INDEX "integration_billing_agreements_clientId_status_effectiveFro_idx" ON "integration_billing_agreements"("clientId", "status", "effectiveFrom", "effectiveUntil");

CREATE TABLE "integration_idempotency_records" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
  "responseStatus" INTEGER, "responseBody" JSONB, "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_idempotency_records_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integration_idempotency_records_clientId_operation_idempote_key" ON "integration_idempotency_records"("clientId", "operation", "idempotencyKey");
CREATE INDEX "integration_idempotency_records_clientId_operation_createdA_idx" ON "integration_idempotency_records"("clientId", "operation", "createdAt");
CREATE INDEX "integration_idempotency_records_expiresAt_idx" ON "integration_idempotency_records"("expiresAt");

CREATE TABLE "integration_external_references" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "resourceType" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL, "internalResourceType" TEXT NOT NULL,
  "internalResourceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_external_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_external_references_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integration_external_references_clientId_resourceType_exter_key" ON "integration_external_references"("clientId", "resourceType", "externalReference");
CREATE INDEX "integration_external_references_internalResourceType_intern_idx" ON "integration_external_references"("internalResourceType", "internalResourceId");

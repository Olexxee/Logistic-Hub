-- GIL-03 generic package assessment and multi-option quote sessions.
CREATE TYPE "IntegrationQuoteSessionStatus" AS ENUM ('QUOTED', 'SELECTED', 'REQUIRES_MEASUREMENT', 'NO_COVERAGE', 'EXPIRED');
CREATE TYPE "IntegrationQuoteOptionStatus" AS ENUM ('AVAILABLE', 'SELECTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "PackageAssessmentStatus" AS ENUM ('DECLARED', 'ESTIMATED', 'MEASURED', 'REQUIRES_MEASUREMENT');

CREATE TABLE "integration_quote_sessions" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "billingAgreementId" TEXT NOT NULL,
  "billingAgreementVersion" INTEGER NOT NULL,
  "externalReference" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" "IntegrationQuoteSessionStatus" NOT NULL DEFAULT 'QUOTED',
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "pickupServiceZoneId" TEXT NOT NULL,
  "destinationServiceZoneId" TEXT NOT NULL,
  "pickupAddress" TEXT NOT NULL,
  "pickupLatitude" DECIMAL(10,7) NOT NULL,
  "pickupLongitude" DECIMAL(10,7) NOT NULL,
  "destinationAddress" TEXT NOT NULL,
  "destinationLatitude" DECIMAL(10,7) NOT NULL,
  "destinationLongitude" DECIMAL(10,7) NOT NULL,
  "recipientName" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "selectedOptionId" TEXT,
  "assessmentSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_quote_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_quote_sessions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_quote_sessions_billingAgreementId_fkey" FOREIGN KEY ("billingAgreementId") REFERENCES "integration_billing_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integration_quote_sessions_clientId_externalReference_key" ON "integration_quote_sessions"("clientId","externalReference");
CREATE UNIQUE INDEX "integration_quote_sessions_clientId_idempotencyKey_key" ON "integration_quote_sessions"("clientId","idempotencyKey");
CREATE INDEX "integration_quote_sessions_clientId_status_createdAt_idx" ON "integration_quote_sessions"("clientId","status","createdAt");
CREATE INDEX "integration_quote_sessions_billingAgreementId_createdAt_idx" ON "integration_quote_sessions"("billingAgreementId","createdAt");

CREATE TABLE "integration_quote_packages" (
  "id" TEXT NOT NULL,
  "quoteSessionId" TEXT NOT NULL,
  "externalPackageRef" TEXT,
  "packageCategory" TEXT NOT NULL,
  "description" TEXT,
  "weightGrams" INTEGER,
  "lengthMm" INTEGER,
  "widthMm" INTEGER,
  "heightMm" INTEGER,
  "declaredValueMinor" BIGINT,
  "assessmentStatus" "PackageAssessmentStatus" NOT NULL DEFAULT 'DECLARED',
  "assessmentSource" TEXT NOT NULL DEFAULT 'INTEGRATOR_DECLARED',
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assessmentConfidence" DECIMAL(5,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_quote_packages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_quote_packages_quoteSessionId_fkey" FOREIGN KEY ("quoteSessionId") REFERENCES "integration_quote_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_quote_packages_weight_positive" CHECK ("weightGrams" IS NULL OR "weightGrams" > 0),
  CONSTRAINT "integration_quote_packages_dimensions_positive" CHECK (
    ("lengthMm" IS NULL OR "lengthMm" > 0) AND
    ("widthMm" IS NULL OR "widthMm" > 0) AND
    ("heightMm" IS NULL OR "heightMm" > 0)
  )
);
CREATE UNIQUE INDEX "integration_quote_packages_quoteSessionId_externalPackageRe_key" ON "integration_quote_packages"("quoteSessionId","externalPackageRef");
CREATE INDEX "integration_quote_packages_quoteSessionId_assessmentStatus_idx" ON "integration_quote_packages"("quoteSessionId","assessmentStatus");

CREATE TABLE "integration_quote_options" (
  "id" TEXT NOT NULL,
  "quoteSessionId" TEXT NOT NULL,
  "optionCode" TEXT NOT NULL,
  "status" "IntegrationQuoteOptionStatus" NOT NULL DEFAULT 'AVAILABLE',
  "partnerAgreementId" TEXT NOT NULL,
  "partnerRateCardId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "logisticsCostMinor" BIGINT NOT NULL,
  "platformChargeMinor" BIGINT NOT NULL,
  "otherChargesMinor" BIGINT NOT NULL DEFAULT 0,
  "customerChargeMinor" BIGINT NOT NULL,
  "estimatedTransitMinutes" INTEGER,
  "routeMode" TEXT NOT NULL,
  "packageRateSnapshot" JSONB NOT NULL,
  "routeSnapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "selectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_quote_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_quote_options_quoteSessionId_fkey" FOREIGN KEY ("quoteSessionId") REFERENCES "integration_quote_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_quote_options_partnerAgreementId_fkey" FOREIGN KEY ("partnerAgreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_quote_options_partnerRateCardId_fkey" FOREIGN KEY ("partnerRateCardId") REFERENCES "partner_rate_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_quote_options_nonnegative_charges" CHECK (
    "logisticsCostMinor" >= 0 AND "platformChargeMinor" >= 0 AND
    "otherChargesMinor" >= 0 AND "customerChargeMinor" >= 0
  )
);
CREATE UNIQUE INDEX "integration_quote_options_quoteSessionId_optionCode_key" ON "integration_quote_options"("quoteSessionId","optionCode");
CREATE INDEX "integration_quote_options_quoteSessionId_status_customerCha_idx" ON "integration_quote_options"("quoteSessionId","status","customerChargeMinor");
CREATE INDEX "integration_quote_options_partnerAgreementId_idx" ON "integration_quote_options"("partnerAgreementId");
CREATE INDEX "integration_quote_options_partnerRateCardId_idx" ON "integration_quote_options"("partnerRateCardId");

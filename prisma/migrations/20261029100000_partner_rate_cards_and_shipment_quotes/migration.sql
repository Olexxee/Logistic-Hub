-- Partner agreements and versioned shipment quotations.
-- This is an additive migration. The immutable initial migration and constraint snapshot remain unchanged.

CREATE TYPE "PartnerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "PartnerAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');
CREATE TYPE "PartnerRateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "ShipmentQuoteStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

CREATE TABLE "transport_partners" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "legalName" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING',
  "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "verifiedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_agreements" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "status" "PartnerAgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "volumeCommitment" JSONB,
  "serviceStandards" JSONB,
  "custodyClaimsTerms" JSONB,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_rate_cards" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PartnerRateCardStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_rate_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_rates" (
  "id" TEXT NOT NULL,
  "rateCardId" TEXT NOT NULL,
  "originServiceZoneId" TEXT NOT NULL,
  "destinationServiceZoneId" TEXT NOT NULL,
  "serviceType" "ServiceType" NOT NULL DEFAULT 'PARCEL_DELIVERY',
  "parcelCategory" TEXT NOT NULL,
  "minWeightGrams" INTEGER NOT NULL DEFAULT 0,
  "maxWeightGrams" INTEGER,
  "maxLengthMm" INTEGER,
  "maxWidthMm" INTEGER,
  "maxHeightMm" INTEGER,
  "transportChargeMinor" BIGINT NOT NULL,
  "estimatedTransitMinutes" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipment_quotes" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ShipmentQuoteStatus" NOT NULL DEFAULT 'OFFERED',
  "partnerAgreementId" TEXT,
  "partnerRateId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "transportChargeMinor" BIGINT NOT NULL,
  "collectionChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "hubHandlingChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "destinationDeliveryChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "platformChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "otherChargesMinor" BIGINT NOT NULL DEFAULT 0,
  "totalCustomerChargeMinor" BIGINT NOT NULL,
  "chargeBreakdown" JSONB NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipment_quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_agreements_reference_key" ON "partner_agreements"("reference");
CREATE INDEX "transport_partners_status_verificationStatus_idx" ON "transport_partners"("status", "verificationStatus");
CREATE INDEX "partner_agreements_partnerId_status_effectiveFrom_idx" ON "partner_agreements"("partnerId", "status", "effectiveFrom");
CREATE INDEX "partner_agreements_status_effectiveFrom_effectiveUntil_idx" ON "partner_agreements"("status", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "partner_rate_cards_agreementId_version_key" ON "partner_rate_cards"("agreementId", "version");
CREATE INDEX "partner_rate_cards_status_effectiveFrom_effectiveUntil_idx" ON "partner_rate_cards"("status", "effectiveFrom", "effectiveUntil");
CREATE INDEX "partner_rates_originServiceZoneId_destinationServiceZoneId_serviceType_parcelCategory_isActive_idx" ON "partner_rates"("originServiceZoneId", "destinationServiceZoneId", "serviceType", "parcelCategory", "isActive");
CREATE INDEX "partner_rates_rateCardId_isActive_idx" ON "partner_rates"("rateCardId", "isActive");
CREATE UNIQUE INDEX "shipment_quotes_parcelBookingId_version_key" ON "shipment_quotes"("parcelBookingId", "version");
CREATE INDEX "shipment_quotes_parcelBookingId_status_expiresAt_idx" ON "shipment_quotes"("parcelBookingId", "status", "expiresAt");
CREATE INDEX "shipment_quotes_partnerAgreementId_idx" ON "shipment_quotes"("partnerAgreementId");
CREATE INDEX "shipment_quotes_partnerRateId_idx" ON "shipment_quotes"("partnerRateId");

-- Only one quote can be accepted for a shipment at a time.
CREATE UNIQUE INDEX "shipment_quotes_one_accepted_per_booking"
  ON "shipment_quotes"("parcelBookingId")
  WHERE "status" = 'ACCEPTED';

ALTER TABLE "partner_agreements"
  ADD CONSTRAINT "partner_agreements_validity_window_check"
  CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");

ALTER TABLE "partner_rate_cards"
  ADD CONSTRAINT "partner_rate_cards_validity_window_check"
  CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"),
  ADD CONSTRAINT "partner_rate_cards_positive_version_check"
  CHECK ("version" > 0);

ALTER TABLE "partner_rates"
  ADD CONSTRAINT "partner_rates_weight_band_check"
  CHECK ("minWeightGrams" >= 0 AND ("maxWeightGrams" IS NULL OR "maxWeightGrams" >= "minWeightGrams")),
  ADD CONSTRAINT "partner_rates_positive_dimensions_check"
  CHECK (
    ("maxLengthMm" IS NULL OR "maxLengthMm" > 0) AND
    ("maxWidthMm" IS NULL OR "maxWidthMm" > 0) AND
    ("maxHeightMm" IS NULL OR "maxHeightMm" > 0) AND
    ("estimatedTransitMinutes" IS NULL OR "estimatedTransitMinutes" > 0)
  ),
  ADD CONSTRAINT "partner_rates_nonnegative_charge_check"
  CHECK ("transportChargeMinor" >= 0);

ALTER TABLE "shipment_quotes"
  ADD CONSTRAINT "shipment_quotes_positive_version_check"
  CHECK ("version" > 0),
  ADD CONSTRAINT "shipment_quotes_nonnegative_charges_check"
  CHECK (
    "transportChargeMinor" >= 0 AND
    "collectionChargeMinor" >= 0 AND
    "hubHandlingChargeMinor" >= 0 AND
    "destinationDeliveryChargeMinor" >= 0 AND
    "platformChargeMinor" >= 0 AND
    "otherChargesMinor" >= 0 AND
    "totalCustomerChargeMinor" >= 0
  ),
  ADD CONSTRAINT "shipment_quotes_total_matches_breakdown_check"
  CHECK (
    "totalCustomerChargeMinor" =
      "transportChargeMinor" +
      "collectionChargeMinor" +
      "hubHandlingChargeMinor" +
      "destinationDeliveryChargeMinor" +
      "platformChargeMinor" +
      "otherChargesMinor"
  ),
  ADD CONSTRAINT "shipment_quotes_acceptance_metadata_check"
  CHECK (
    ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL)
    OR
    ("status" <> 'ACCEPTED')
  );

ALTER TABLE "partner_agreements"
  ADD CONSTRAINT "partner_agreements_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partner_rate_cards"
  ADD CONSTRAINT "partner_rate_cards_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "partner_agreements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partner_rates"
  ADD CONSTRAINT "partner_rates_rateCardId_fkey"
  FOREIGN KEY ("rateCardId") REFERENCES "partner_rate_cards"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_rates_originServiceZoneId_fkey"
  FOREIGN KEY ("originServiceZoneId") REFERENCES "service_zones"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_rates_destinationServiceZoneId_fkey"
  FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipment_quotes"
  ADD CONSTRAINT "shipment_quotes_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shipment_quotes_partnerAgreementId_fkey"
  FOREIGN KEY ("partnerAgreementId") REFERENCES "partner_agreements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shipment_quotes_partnerRateId_fkey"
  FOREIGN KEY ("partnerRateId") REFERENCES "partner_rates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shipment_quotes_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "PartnerAssignmentStatus" AS ENUM (
  'OFFERED',
  'ACCEPTED',
  'REJECTED',
  'IN_TRANSIT',
  'ARRIVED_AT_HUB',
  'COMPLETED',
  'CANCELLED',
  'FAILED'
);

CREATE TABLE "partner_api_credentials" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_api_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_assignments" (
  "id" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "shipmentQuoteId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "partnerAgreementId" TEXT NOT NULL,
  "status" "PartnerAssignmentStatus" NOT NULL DEFAULT 'OFFERED',
  "currency" TEXT NOT NULL,
  "quotedTransportChargeMinor" BIGINT NOT NULL,
  "partnerReference" TEXT,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "arrivedAtHubAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_api_credentials_tokenHash_key" ON "partner_api_credentials"("tokenHash");
CREATE INDEX "partner_api_credentials_partnerId_revokedAt_idx" ON "partner_api_credentials"("partnerId", "revokedAt");
CREATE INDEX "partner_api_credentials_expiresAt_revokedAt_idx" ON "partner_api_credentials"("expiresAt", "revokedAt");
CREATE UNIQUE INDEX "partner_assignments_deliveryLegId_key" ON "partner_assignments"("deliveryLegId");
CREATE UNIQUE INDEX "partner_assignments_shipmentQuoteId_key" ON "partner_assignments"("shipmentQuoteId");
CREATE INDEX "partner_assignments_partnerId_status_offeredAt_idx" ON "partner_assignments"("partnerId", "status", "offeredAt");
CREATE INDEX "partner_assignments_parcelBookingId_status_idx" ON "partner_assignments"("parcelBookingId", "status");
CREATE INDEX "partner_assignments_partnerAgreementId_idx" ON "partner_assignments"("partnerAgreementId");

ALTER TABLE "partner_api_credentials"
  ADD CONSTRAINT "partner_api_credentials_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_assignments"
  ADD CONSTRAINT "partner_assignments_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_assignments_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_assignments_shipmentQuoteId_fkey"
  FOREIGN KEY ("shipmentQuoteId") REFERENCES "shipment_quotes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_assignments_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_assignments_partnerAgreementId_fkey"
  FOREIGN KEY ("partnerAgreementId") REFERENCES "partner_agreements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_assignments_positive_transport_charge"
  CHECK ("quotedTransportChargeMinor" >= 0);

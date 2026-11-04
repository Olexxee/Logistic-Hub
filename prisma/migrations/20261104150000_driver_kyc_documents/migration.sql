CREATE TYPE "DriverKycTier" AS ENUM ('UNASSESSED', 'TEST_LIMITED', 'FULL');
CREATE TYPE "DriverDocumentType" AS ENUM ('IDENTITY', 'DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'ROADWORTHINESS');
CREATE TYPE "DriverDocumentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "driver_profiles"
ADD COLUMN "kycTier" "DriverKycTier" NOT NULL DEFAULT 'UNASSESSED';

CREATE TABLE "driver_verification_documents" (
  "id" TEXT NOT NULL,
  "driverProfileId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "mediaAssetId" TEXT NOT NULL,
  "documentType" "DriverDocumentType" NOT NULL,
  "reviewStatus" "DriverDocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "driver_verification_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_verification_documents_mediaAssetId_key" ON "driver_verification_documents"("mediaAssetId");
CREATE INDEX "driver_verification_documents_driverProfileId_documentType__idx" ON "driver_verification_documents"("driverProfileId", "documentType", "reviewStatus", "createdAt");
CREATE INDEX "driver_verification_documents_vehicleId_documentType_review_idx" ON "driver_verification_documents"("vehicleId", "documentType", "reviewStatus", "createdAt");
CREATE INDEX "driver_verification_documents_reviewStatus_createdAt_idx" ON "driver_verification_documents"("reviewStatus", "createdAt");

ALTER TABLE "driver_verification_documents"
ADD CONSTRAINT "driver_verification_documents_driverProfileId_fkey"
FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_verification_documents"
ADD CONSTRAINT "driver_verification_documents_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_verification_documents"
ADD CONSTRAINT "driver_verification_documents_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "driver_verification_documents"
ADD CONSTRAINT "driver_verification_documents_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

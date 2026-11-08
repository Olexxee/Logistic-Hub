CREATE TABLE "integration_packing_evidence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "parcelBookingId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "actorReference" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'CLOUDINARY',
    "bucket" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_packing_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_packing_evidence_objectPath_key" ON "integration_packing_evidence"("objectPath");
CREATE UNIQUE INDEX "integration_packing_evidence_clientId_idempotencyKey_key" ON "integration_packing_evidence"("clientId", "idempotencyKey");
CREATE UNIQUE INDEX "integration_packing_evidence_parcelBookingId_slot_version_key" ON "integration_packing_evidence"("parcelBookingId", "slot", "version");
CREATE INDEX "integration_packing_evidence_client_booking_slot_version_idx" ON "integration_packing_evidence"("clientId", "parcelBookingId", "slot", "version");

ALTER TABLE "integration_packing_evidence" ADD CONSTRAINT "integration_packing_evidence_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_packing_evidence" ADD CONSTRAINT "integration_packing_evidence_parcelBookingId_fkey"
FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

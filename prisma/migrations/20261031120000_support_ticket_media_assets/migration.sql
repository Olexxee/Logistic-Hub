CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'FIREBASE',
    "bucket" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_assets_objectPath_key" ON "media_assets"("objectPath");
CREATE INDEX "media_assets_uploadedById_createdAt_idx" ON "media_assets"("uploadedById", "createdAt");
CREATE INDEX "media_assets_deletedAt_createdAt_idx" ON "media_assets"("deletedAt", "createdAt");
CREATE UNIQUE INDEX "support_ticket_attachments_ticketId_mediaAssetId_key" ON "support_ticket_attachments"("ticketId", "mediaAssetId");
CREATE INDEX "support_ticket_attachments_ticketId_createdAt_idx" ON "support_ticket_attachments"("ticketId", "createdAt");
CREATE INDEX "support_ticket_attachments_mediaAssetId_idx" ON "support_ticket_attachments"("mediaAssetId");

ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_ticket_attachments"
ADD CONSTRAINT "support_ticket_attachments_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_ticket_attachments"
ADD CONSTRAINT "support_ticket_attachments_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

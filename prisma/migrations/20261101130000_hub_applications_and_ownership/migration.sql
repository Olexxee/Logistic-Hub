CREATE TYPE "HubApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

ALTER TABLE "hub_points"
  ADD COLUMN "partnerId" TEXT;

CREATE INDEX "hub_points_partnerId_status_idx"
  ON "hub_points"("partnerId", "status");

ALTER TABLE "hub_points"
  ADD CONSTRAINT "hub_points_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "hub_applications" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "applicantUserId" TEXT NOT NULL,
  "serviceZoneId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "operatorName" TEXT NOT NULL,
  "operatorPhone" TEXT NOT NULL,
  "openingHours" JSONB NOT NULL,
  "acceptedParcelTypes" JSONB NOT NULL,
  "capacityConfig" JSONB NOT NULL,
  "status" "HubApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "hubPointId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hub_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hub_applications_hubPointId_key"
  ON "hub_applications"("hubPointId");
CREATE INDEX "hub_applications_partnerId_status_createdAt_idx"
  ON "hub_applications"("partnerId", "status", "createdAt");
CREATE INDEX "hub_applications_applicantUserId_createdAt_idx"
  ON "hub_applications"("applicantUserId", "createdAt");
CREATE INDEX "hub_applications_status_createdAt_idx"
  ON "hub_applications"("status", "createdAt");

ALTER TABLE "hub_applications"
  ADD CONSTRAINT "hub_applications_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_applications"
  ADD CONSTRAINT "hub_applications_applicantUserId_fkey"
  FOREIGN KEY ("applicantUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_applications"
  ADD CONSTRAINT "hub_applications_serviceZoneId_fkey"
  FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_applications"
  ADD CONSTRAINT "hub_applications_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_applications"
  ADD CONSTRAINT "hub_applications_hubPointId_fkey"
  FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


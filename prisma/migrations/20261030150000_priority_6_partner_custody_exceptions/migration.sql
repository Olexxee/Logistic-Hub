ALTER TYPE "UserRole" ADD VALUE 'PARTNER_OPERATOR';

CREATE TYPE "PartnerAssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "CustodyPartyType" AS ENUM ('SENDER', 'DRIVER', 'HUB', 'TRANSPORT_PARTNER', 'RECIPIENT');
CREATE TYPE "CustodyHandoverStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "OperationalCaseType" AS ENUM ('FAILED_HANDOVER', 'DAMAGED_PARCEL', 'MISSING_PARCEL', 'FAILED_DELIVERY', 'PARTNER_DELAY', 'ROUTE_DISRUPTION', 'PRICING_EXCEPTION', 'CUSTOMER_DISPUTE', 'OTHER');
CREATE TYPE "OperationalCaseStatus" AS ENUM ('OPEN', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "OperationalCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "PartnerMemberRole" AS ENUM ('OWNER', 'OPERATIONS', 'DISPATCHER');
CREATE TYPE "HubOperatorRole" AS ENUM ('MANAGER', 'OPERATOR');

CREATE TABLE "transport_partner_members" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "PartnerMemberRole" NOT NULL DEFAULT 'OPERATIONS',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transport_partner_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transport_partner_members_partnerId_userId_key" ON "transport_partner_members"("partnerId", "userId");
CREATE INDEX "transport_partner_members_userId_isActive_idx" ON "transport_partner_members"("userId", "isActive");
CREATE INDEX "transport_partner_members_partnerId_isActive_idx" ON "transport_partner_members"("partnerId", "isActive");
ALTER TABLE "transport_partner_members" ADD CONSTRAINT "transport_partner_members_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_partner_members" ADD CONSTRAINT "transport_partner_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hub_point_operators" (
  "id" TEXT NOT NULL,
  "hubPointId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "HubOperatorRole" NOT NULL DEFAULT 'OPERATOR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hub_point_operators_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hub_point_operators_hubPointId_userId_key" ON "hub_point_operators"("hubPointId", "userId");
CREATE INDEX "hub_point_operators_userId_isActive_idx" ON "hub_point_operators"("userId", "isActive");
CREATE INDEX "hub_point_operators_hubPointId_isActive_idx" ON "hub_point_operators"("hubPointId", "isActive");
ALTER TABLE "hub_point_operators" ADD CONSTRAINT "hub_point_operators_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_point_operators" ADD CONSTRAINT "hub_point_operators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "partner_delivery_assignments" (
  "id" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "assignedByUserId" TEXT,
  "status" "PartnerAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
  "agreedTransportChargeMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "idempotencyKey" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_delivery_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "partner_delivery_assignments_idempotencyKey_key" ON "partner_delivery_assignments"("idempotencyKey");
CREATE INDEX "partner_delivery_assignments_deliveryLegId_status_idx" ON "partner_delivery_assignments"("deliveryLegId", "status");
CREATE INDEX "partner_delivery_assignments_partnerId_status_assignedAt_idx" ON "partner_delivery_assignments"("partnerId", "status", "assignedAt");
CREATE INDEX "partner_delivery_assignments_agreementId_status_idx" ON "partner_delivery_assignments"("agreementId", "status");
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "custody_handovers" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "hubPointId" TEXT,
  "fromPartyType" "CustodyPartyType" NOT NULL,
  "fromPartyId" TEXT NOT NULL,
  "toPartyType" "CustodyPartyType" NOT NULL,
  "toPartyId" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "status" "CustodyHandoverStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "conditionAtRelease" TEXT NOT NULL,
  "conditionAtReceipt" TEXT,
  "evidence" JSONB,
  "verificationCodeHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "custody_handovers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "custody_handovers_parcelBookingId_initiatedAt_idx" ON "custody_handovers"("parcelBookingId", "initiatedAt");
CREATE INDEX "custody_handovers_deliveryLegId_status_initiatedAt_idx" ON "custody_handovers"("deliveryLegId", "status", "initiatedAt");
CREATE INDEX "custody_handovers_hubPointId_status_initiatedAt_idx" ON "custody_handovers"("hubPointId", "status", "initiatedAt");
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "operational_cases" (
  "id" TEXT NOT NULL,
  "publicReference" TEXT NOT NULL,
  "type" "OperationalCaseType" NOT NULL,
  "status" "OperationalCaseStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "OperationalCasePriority" NOT NULL DEFAULT 'NORMAL',
  "parcelBookingId" TEXT,
  "deliveryLegId" TEXT,
  "custodyHandoverId" TEXT,
  "partnerId" TEXT,
  "hubPointId" TEXT,
  "reportedByUserId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" JSONB,
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operational_cases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operational_cases_publicReference_key" ON "operational_cases"("publicReference");
CREATE INDEX "operational_cases_status_priority_createdAt_idx" ON "operational_cases"("status", "priority", "createdAt");
CREATE INDEX "operational_cases_parcelBookingId_status_idx" ON "operational_cases"("parcelBookingId", "status");
CREATE INDEX "operational_cases_deliveryLegId_status_idx" ON "operational_cases"("deliveryLegId", "status");
CREATE INDEX "operational_cases_partnerId_status_idx" ON "operational_cases"("partnerId", "status");
CREATE INDEX "operational_cases_hubPointId_status_idx" ON "operational_cases"("hubPointId", "status");
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_custodyHandoverId_fkey" FOREIGN KEY ("custodyHandoverId") REFERENCES "custody_handovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

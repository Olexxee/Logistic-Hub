-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'DRIVER', 'HUB_OPERATOR', 'PARTNER_OPERATOR', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BICYCLE', 'MOTORCYCLE', 'CAR', 'VAN', 'PICKUP', 'TRUCK');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('PARCEL_DELIVERY', 'PASSENGER_RIDE', 'HUB_POINT', 'BUSINESS_LOGISTICS');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'MATCHING', 'AWAITING_CUSTOMER_ACCEPTANCE', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'DRIVER_ASSIGNED', 'PICKUP_VERIFICATION_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERY_VERIFICATION_PENDING', 'COMPLETED', 'CANCELLATION_PENDING', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('DRAFT', 'MATCHING', 'AWAITING_CUSTOMER_ACCEPTANCE', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'PICKUP_VERIFICATION_PENDING', 'TRIP_IN_PROGRESS', 'TRIP_COMPLETION_PENDING', 'COMPLETED', 'CANCELLATION_PENDING', 'CANCELLED', 'NO_DRIVER_FOUND', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIALIZED', 'PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'REVERSED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('AWAITING_PAYMENT', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKUP_CONFIRMED', 'IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryLegType" AS ENUM ('DIRECT', 'LOCAL_PICKUP', 'HUB_TRANSFER', 'INTERSTATE_TRANSPORT', 'FINAL_MILE');

-- CreateEnum
CREATE TYPE "DeliveryLegStatus" AS ENUM ('PLANNED', 'READY_FOR_ASSIGNMENT', 'AWAITING_PAYMENT', 'ASSIGNED', 'PICKUP_VERIFICATION_PENDING', 'IN_TRANSIT', 'DELIVERY_VERIFICATION_PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VerificationAction" AS ENUM ('PARCEL_PICKUP', 'PARCEL_DELIVERY', 'RIDE_PICKUP', 'RIDE_COMPLETION');

-- CreateEnum
CREATE TYPE "VerificationTokenStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "LedgerEntrySide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SettlementAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "HubPointStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PartnerAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PartnerRateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ShipmentQuoteStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PartnerAssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PartnerPayableStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'IN_BATCH', 'RECONCILED', 'DISPUTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PartnerSettlementBatchStatus" AS ENUM ('DRAFT', 'APPROVED', 'RECONCILIATION_REQUIRED', 'RECONCILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PartnerReconciliationOutcome" AS ENUM ('MATCHED', 'VARIANCE', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PartnerPayableAdjustmentType" AS ENUM ('INCREASE', 'DECREASE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CustodyPartyType" AS ENUM ('SENDER', 'DRIVER', 'HUB', 'TRANSPORT_PARTNER', 'RECIPIENT');

-- CreateEnum
CREATE TYPE "CustodyHandoverStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OperationalCaseType" AS ENUM ('FAILED_HANDOVER', 'DAMAGED_PARCEL', 'MISSING_PARCEL', 'FAILED_DELIVERY', 'PARTNER_DELAY', 'ROUTE_DISRUPTION', 'PRICING_EXCEPTION', 'CUSTOMER_DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "OperationalCaseStatus" AS ENUM ('OPEN', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OperationalCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PartnerMemberRole" AS ENUM ('OWNER', 'OPERATIONS', 'DISPATCHER');

-- CreateEnum
CREATE TYPE "HubOperatorRole" AS ENUM ('MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "HubIntakeStatus" AS ENUM ('RECEIVED', 'RELEASED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_action_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "emailStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "emailSentAt" TIMESTAMP(3),
    "emailProviderId" TEXT,
    "emailErrorCode" TEXT,
    "deliveryKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "reinstatedAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "serviceRadiusMeters" INTEGER NOT NULL DEFAULT 5000,
    "averageRating" DECIMAL(3,2),
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "cancelledJobs" INTEGER NOT NULL DEFAULT 0,
    "lastLocationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_settlement_accounts" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PAYSTACK',
    "externalAccountRef" TEXT NOT NULL,
    "status" "SettlementAccountStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "verifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_settlement_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "registrationPlate" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "parcelCapacity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_locations" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyMeters" DECIMAL(8,2),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lgas" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lgas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_zones" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "lgaId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "boundaryGeoJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_availability" (
    "id" TEXT NOT NULL,
    "serviceZoneId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_coverage" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "serviceZoneId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_points" (
    "id" TEXT NOT NULL,
    "serviceZoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "status" "HubPointStatus" NOT NULL DEFAULT 'PENDING',
    "operatorName" TEXT,
    "operatorPhone" TEXT,
    "operatorVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "operatorVerifiedAt" TIMESTAMP(3),
    "operatorVerificationNotes" TEXT,
    "openingHours" JSONB,
    "acceptedParcelTypes" JSONB,
    "capacityConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "serviceZoneId" TEXT,
    "serviceType" "ServiceType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "fixedConnectionFeeMinor" BIGINT NOT NULL,
    "minimumDriverFareMinor" BIGINT NOT NULL DEFAULT 0,
    "baseFareMinor" BIGINT NOT NULL DEFAULT 0,
    "perKmMinor" BIGINT NOT NULL DEFAULT 0,
    "perMinuteMinor" BIGINT NOT NULL DEFAULT 0,
    "config" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcel_bookings" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "idempotencyPayloadHash" TEXT,
    "fareAcceptanceIdempotencyKey" TEXT,
    "fareAcceptancePayloadHash" TEXT,
    "senderId" TEXT NOT NULL,
    "pickupServiceZoneId" TEXT NOT NULL,
    "destinationServiceZoneId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZED',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "pickupAddress" TEXT NOT NULL,
    "pickupLatitude" DECIMAL(10,7) NOT NULL,
    "pickupLongitude" DECIMAL(10,7) NOT NULL,
    "pickupInstructions" TEXT,
    "destinationAddress" TEXT NOT NULL,
    "destinationLatitude" DECIMAL(10,7) NOT NULL,
    "destinationLongitude" DECIMAL(10,7) NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "parcelCategory" TEXT NOT NULL,
    "parcelDescription" TEXT,
    "parcelSize" TEXT NOT NULL,
    "declaredValueMinor" BIGINT,
    "handlingInstructions" TEXT,
    "driverFareMinor" BIGINT,
    "connectionFeeMinor" BIGINT NOT NULL,
    "otherChargesMinor" BIGINT NOT NULL DEFAULT 0,
    "customerPayableMinor" BIGINT,
    "pricingRuleId" TEXT,
    "pricingSnapshot" JSONB NOT NULL,
    "paidAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_bookings" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "idempotencyPayloadHash" TEXT,
    "fareAcceptanceIdempotencyKey" TEXT,
    "fareAcceptancePayloadHash" TEXT,
    "passengerId" TEXT NOT NULL,
    "pickupServiceZoneId" TEXT NOT NULL,
    "destinationServiceZoneId" TEXT NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZED',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "pickupAddress" TEXT NOT NULL,
    "pickupLatitude" DECIMAL(10,7) NOT NULL,
    "pickupLongitude" DECIMAL(10,7) NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "destinationLatitude" DECIMAL(10,7) NOT NULL,
    "destinationLongitude" DECIMAL(10,7) NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "driverFareMinor" BIGINT,
    "connectionFeeMinor" BIGINT NOT NULL,
    "customerPayableMinor" BIGINT,
    "pricingSnapshot" JSONB NOT NULL,
    "paidAt" TIMESTAMP(3),
    "tripStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_offers" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "driverProfileId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "proposedFareMinor" BIGINT,
    "fareProposalIdempotencyKey" TEXT,
    "fareProposalPayloadHash" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "deliveryLegId" TEXT,
    "driverProfileId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "agreedFareMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentExpiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "pickupAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_legs" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "DeliveryLegType" NOT NULL,
    "status" "DeliveryLegStatus" NOT NULL DEFAULT 'PLANNED',
    "originServiceZoneId" TEXT NOT NULL,
    "destinationServiceZoneId" TEXT NOT NULL,
    "originHubPointId" TEXT,
    "destinationHubPointId" TEXT,
    "originLatitude" DECIMAL(10,7),
    "originLongitude" DECIMAL(10,7),
    "destinationLatitude" DECIMAL(10,7),
    "destinationLongitude" DECIMAL(10,7),
    "plannedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_leg_offers" (
    "id" TEXT NOT NULL,
    "deliveryLegId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "proposedFareMinor" BIGINT,
    "proposalIdempotencyKey" TEXT,
    "proposalPayloadHash" TEXT,
    "acceptanceIdempotencyKey" TEXT,
    "acceptancePayloadHash" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_leg_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'PAYSTACK',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZED',
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "providerFeeMinor" BIGINT,
    "driverAllocationMinor" BIGINT,
    "platformAllocationMinor" BIGINT,
    "driverSettlementAccountId" TEXT,
    "splitConfigurationSnapshot" JSONB,
    "providerPayload" JSONB,
    "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "journalReference" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "LedgerEntrySide" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "paymentAttemptId" TEXT,
    "payoutId" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payouts" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'PAYSTACK',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "providerPayload" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerResponse" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "deliveryLegId" TEXT,
    "action" "VerificationAction" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "VerificationTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "bookingType" TEXT,
    "bookingId" TEXT,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "operational_audit_events" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "hub_intake_records" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT NOT NULL,
    "deliveryLegId" TEXT NOT NULL,
    "hubPointId" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "status" "HubIntakeStatus" NOT NULL DEFAULT 'RECEIVED',
    "weightGrams" INTEGER NOT NULL,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "volumeCm3" INTEGER,
    "conditionAtReceipt" TEXT NOT NULL,
    "evidence" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "exceptionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_intake_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "partner_payables" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerDeliveryAssignmentId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "deliveryLegId" TEXT NOT NULL,
    "sourceChargeMinor" BIGINT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PartnerPayableStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payable_adjustments" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "type" "PartnerPayableAdjustmentType" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_payable_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_batches" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalAmountMinor" BIGINT NOT NULL,
    "status" "PartnerSettlementBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reconciledByUserId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "externalReference" TEXT,
    "reconciliationOutcome" "PartnerReconciliationOutcome",
    "reconciledAmountMinor" BIGINT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_batch_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_settlement_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_reconciliations" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "outcome" "PartnerReconciliationOutcome" NOT NULL,
    "expectedAmountMinor" BIGINT NOT NULL,
    "actualAmountMinor" BIGINT NOT NULL,
    "externalReference" TEXT,
    "evidence" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_settlement_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_action_tokens_tokenHash_key" ON "auth_action_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_action_tokens_userId_purpose_consumedAt_idx" ON "auth_action_tokens"("userId", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "auth_action_tokens_purpose_expiresAt_idx" ON "auth_action_tokens"("purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_revokedAt_expiresAt_idx" ON "auth_sessions"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_deliveryKey_key" ON "notifications"("deliveryKey");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_emailStatus_createdAt_idx" ON "notifications"("emailStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");

-- CreateIndex
CREATE INDEX "driver_profiles_verificationStatus_isOnline_isAvailable_idx" ON "driver_profiles"("verificationStatus", "isOnline", "isAvailable");

-- CreateIndex
CREATE INDEX "driver_settlement_accounts_status_provider_idx" ON "driver_settlement_accounts"("status", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "driver_settlement_accounts_driverProfileId_provider_key" ON "driver_settlement_accounts"("driverProfileId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "driver_settlement_accounts_provider_externalAccountRef_key" ON "driver_settlement_accounts"("provider", "externalAccountRef");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registrationPlate_key" ON "vehicles"("registrationPlate");

-- CreateIndex
CREATE INDEX "vehicles_driverProfileId_isActive_verificationStatus_idx" ON "vehicles"("driverProfileId", "isActive", "verificationStatus");

-- CreateIndex
CREATE INDEX "driver_locations_driverProfileId_recordedAt_idx" ON "driver_locations"("driverProfileId", "recordedAt");

-- CreateIndex
CREATE INDEX "driver_locations_recordedAt_idx" ON "driver_locations"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateIndex
CREATE INDEX "states_countryId_isActive_idx" ON "states"("countryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "states_countryId_code_key" ON "states"("countryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "states_countryId_name_key" ON "states"("countryId", "name");

-- CreateIndex
CREATE INDEX "lgas_stateId_idx" ON "lgas"("stateId");

-- CreateIndex
CREATE UNIQUE INDEX "lgas_id_stateId_key" ON "lgas"("id", "stateId");

-- CreateIndex
CREATE UNIQUE INDEX "lgas_stateId_name_key" ON "lgas"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lgas_stateId_code_key" ON "lgas"("stateId", "code");

-- CreateIndex
CREATE INDEX "service_zones_stateId_isActive_idx" ON "service_zones"("stateId", "isActive");

-- CreateIndex
CREATE INDEX "service_zones_lgaId_idx" ON "service_zones"("lgaId");

-- CreateIndex
CREATE UNIQUE INDEX "service_zones_stateId_code_key" ON "service_zones"("stateId", "code");

-- CreateIndex
CREATE INDEX "service_availability_serviceType_isEnabled_idx" ON "service_availability"("serviceType", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "service_availability_serviceZoneId_serviceType_key" ON "service_availability"("serviceZoneId", "serviceType");

-- CreateIndex
CREATE INDEX "driver_coverage_serviceZoneId_serviceType_isEnabled_idx" ON "driver_coverage"("serviceZoneId", "serviceType", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "driver_coverage_driverProfileId_serviceZoneId_serviceType_key" ON "driver_coverage"("driverProfileId", "serviceZoneId", "serviceType");

-- CreateIndex
CREATE INDEX "hub_points_serviceZoneId_status_idx" ON "hub_points"("serviceZoneId", "status");

-- CreateIndex
CREATE INDEX "pricing_rules_serviceType_isActive_effectiveFrom_idx" ON "pricing_rules"("serviceType", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "pricing_rules_serviceZoneId_serviceType_isActive_idx" ON "pricing_rules"("serviceZoneId", "serviceType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_bookings_publicReference_key" ON "parcel_bookings"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_bookings_idempotencyKey_key" ON "parcel_bookings"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_bookings_fareAcceptanceIdempotencyKey_key" ON "parcel_bookings"("fareAcceptanceIdempotencyKey");

-- CreateIndex
CREATE INDEX "parcel_bookings_senderId_createdAt_idx" ON "parcel_bookings"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "parcel_bookings_pickupServiceZoneId_status_createdAt_idx" ON "parcel_bookings"("pickupServiceZoneId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "parcel_bookings_destinationServiceZoneId_status_createdAt_idx" ON "parcel_bookings"("destinationServiceZoneId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "parcel_bookings_status_paymentStatus_createdAt_idx" ON "parcel_bookings"("status", "paymentStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ride_bookings_publicReference_key" ON "ride_bookings"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "ride_bookings_idempotencyKey_key" ON "ride_bookings"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ride_bookings_fareAcceptanceIdempotencyKey_key" ON "ride_bookings"("fareAcceptanceIdempotencyKey");

-- CreateIndex
CREATE INDEX "ride_bookings_passengerId_createdAt_idx" ON "ride_bookings"("passengerId", "createdAt");

-- CreateIndex
CREATE INDEX "ride_bookings_pickupServiceZoneId_status_createdAt_idx" ON "ride_bookings"("pickupServiceZoneId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ride_bookings_destinationServiceZoneId_status_createdAt_idx" ON "ride_bookings"("destinationServiceZoneId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "driver_offers_fareProposalIdempotencyKey_key" ON "driver_offers"("fareProposalIdempotencyKey");

-- CreateIndex
CREATE INDEX "driver_offers_driverProfileId_status_expiresAt_idx" ON "driver_offers"("driverProfileId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "driver_offers_parcelBookingId_status_expiresAt_idx" ON "driver_offers"("parcelBookingId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "driver_offers_rideBookingId_status_expiresAt_idx" ON "driver_offers"("rideBookingId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "driver_assignments_driverProfileId_status_reservedAt_idx" ON "driver_assignments"("driverProfileId", "status", "reservedAt");

-- CreateIndex
CREATE INDEX "driver_assignments_parcelBookingId_status_idx" ON "driver_assignments"("parcelBookingId", "status");

-- CreateIndex
CREATE INDEX "driver_assignments_rideBookingId_status_idx" ON "driver_assignments"("rideBookingId", "status");

-- CreateIndex
CREATE INDEX "driver_assignments_deliveryLegId_status_idx" ON "driver_assignments"("deliveryLegId", "status");

-- CreateIndex
CREATE INDEX "delivery_legs_status_plannedAt_idx" ON "delivery_legs"("status", "plannedAt");

-- CreateIndex
CREATE INDEX "delivery_legs_route_status_idx" ON "delivery_legs"("originServiceZoneId", "destinationServiceZoneId", "status");

-- CreateIndex
CREATE INDEX "delivery_legs_originHubPointId_idx" ON "delivery_legs"("originHubPointId");

-- CreateIndex
CREATE INDEX "delivery_legs_destinationHubPointId_idx" ON "delivery_legs"("destinationHubPointId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_legs_parcelBookingId_sequence_key" ON "delivery_legs"("parcelBookingId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_leg_offers_proposalIdempotencyKey_key" ON "delivery_leg_offers"("proposalIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_leg_offers_acceptanceIdempotencyKey_key" ON "delivery_leg_offers"("acceptanceIdempotencyKey");

-- CreateIndex
CREATE INDEX "delivery_leg_offers_deliveryLegId_status_expiresAt_idx" ON "delivery_leg_offers"("deliveryLegId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "delivery_leg_offers_driverProfileId_status_expiresAt_idx" ON "delivery_leg_offers"("driverProfileId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_providerReference_key" ON "payment_attempts"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotencyKey_key" ON "payment_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_attempts_parcelBookingId_status_idx" ON "payment_attempts"("parcelBookingId", "status");

-- CreateIndex
CREATE INDEX "payment_attempts_rideBookingId_status_idx" ON "payment_attempts"("rideBookingId", "status");

-- CreateIndex
CREATE INDEX "payment_attempts_provider_status_createdAt_idx" ON "payment_attempts"("provider", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_currency_isActive_idx" ON "ledger_accounts"("type", "currency", "isActive");

-- CreateIndex
CREATE INDEX "ledger_entries_journalReference_idx" ON "ledger_entries"("journalReference");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_postedAt_idx" ON "ledger_entries"("accountId", "postedAt");

-- CreateIndex
CREATE INDEX "ledger_entries_parcelBookingId_idx" ON "ledger_entries"("parcelBookingId");

-- CreateIndex
CREATE INDEX "ledger_entries_rideBookingId_idx" ON "ledger_entries"("rideBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_payouts_providerReference_key" ON "driver_payouts"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "driver_payouts_idempotencyKey_key" ON "driver_payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "driver_payouts_driverProfileId_status_createdAt_idx" ON "driver_payouts"("driverProfileId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "driver_payouts_status_createdAt_idx" ON "driver_payouts"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refund_requests_publicReference_key" ON "refund_requests"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "refund_requests_providerReference_key" ON "refund_requests"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "refund_requests_idempotencyKey_key" ON "refund_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "refund_requests_status_createdAt_idx" ON "refund_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "refund_requests_paymentAttemptId_status_idx" ON "refund_requests"("paymentAttemptId", "status");

-- CreateIndex
CREATE INDEX "refund_requests_parcelBookingId_status_idx" ON "refund_requests"("parcelBookingId", "status");

-- CreateIndex
CREATE INDEX "refund_requests_rideBookingId_status_idx" ON "refund_requests"("rideBookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_parcelBookingId_action_status_idx" ON "verification_tokens"("parcelBookingId", "action", "status");

-- CreateIndex
CREATE INDEX "verification_tokens_rideBookingId_action_status_idx" ON "verification_tokens"("rideBookingId", "action", "status");

-- CreateIndex
CREATE INDEX "verification_tokens_deliveryLegId_action_status_idx" ON "verification_tokens"("deliveryLegId", "action", "status");

-- CreateIndex
CREATE INDEX "verification_tokens_status_expiresAt_idx" ON "verification_tokens"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "booking_events_parcelBookingId_createdAt_idx" ON "booking_events"("parcelBookingId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_events_rideBookingId_createdAt_idx" ON "booking_events"("rideBookingId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_events_actorUserId_createdAt_idx" ON "booking_events"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_publicReference_key" ON "support_tickets"("publicReference");

-- CreateIndex
CREATE INDEX "support_tickets_customerId_status_createdAt_idx" ON "support_tickets"("customerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_createdAt_idx" ON "support_tickets"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_assignedToUserId_status_idx" ON "support_tickets"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "support_tickets_parcelBookingId_status_idx" ON "support_tickets"("parcelBookingId", "status");

-- CreateIndex
CREATE INDEX "support_tickets_rideBookingId_status_idx" ON "support_tickets"("rideBookingId", "status");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_windowEndsAt_idx" ON "rate_limit_buckets"("windowEndsAt");

-- CreateIndex
CREATE INDEX "provider_webhook_events_provider_processedAt_receivedAt_idx" ON "provider_webhook_events"("provider", "processedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_provider_providerEventId_key" ON "provider_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "transport_partners_status_verificationStatus_idx" ON "transport_partners"("status", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "partner_agreements_reference_key" ON "partner_agreements"("reference");

-- CreateIndex
CREATE INDEX "partner_agreements_partnerId_status_effectiveFrom_idx" ON "partner_agreements"("partnerId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "partner_agreements_status_effectiveFrom_effectiveUntil_idx" ON "partner_agreements"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "partner_rate_cards_status_effectiveFrom_effectiveUntil_idx" ON "partner_rate_cards"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "partner_rate_cards_agreementId_version_key" ON "partner_rate_cards"("agreementId", "version");

-- CreateIndex
CREATE INDEX "partner_rates_originServiceZoneId_destinationServiceZoneId_serv" ON "partner_rates"("originServiceZoneId", "destinationServiceZoneId", "serviceType", "parcelCategory", "isActive");

-- CreateIndex
CREATE INDEX "partner_rates_rateCardId_isActive_idx" ON "partner_rates"("rateCardId", "isActive");

-- CreateIndex
CREATE INDEX "shipment_quotes_parcelBookingId_status_expiresAt_idx" ON "shipment_quotes"("parcelBookingId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "shipment_quotes_partnerAgreementId_idx" ON "shipment_quotes"("partnerAgreementId");

-- CreateIndex
CREATE INDEX "shipment_quotes_partnerRateId_idx" ON "shipment_quotes"("partnerRateId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_quotes_parcelBookingId_version_key" ON "shipment_quotes"("parcelBookingId", "version");

-- CreateIndex
CREATE INDEX "operational_audit_events_entityType_entityId_createdAt_idx" ON "operational_audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "operational_audit_events_actorUserId_createdAt_idx" ON "operational_audit_events"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "transport_partner_members_userId_isActive_idx" ON "transport_partner_members"("userId", "isActive");

-- CreateIndex
CREATE INDEX "transport_partner_members_partnerId_isActive_idx" ON "transport_partner_members"("partnerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "transport_partner_members_partnerId_userId_key" ON "transport_partner_members"("partnerId", "userId");

-- CreateIndex
CREATE INDEX "hub_point_operators_userId_isActive_idx" ON "hub_point_operators"("userId", "isActive");

-- CreateIndex
CREATE INDEX "hub_point_operators_hubPointId_isActive_idx" ON "hub_point_operators"("hubPointId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hub_point_operators_hubPointId_userId_key" ON "hub_point_operators"("hubPointId", "userId");

-- CreateIndex
CREATE INDEX "hub_intake_records_hubPointId_status_receivedAt_idx" ON "hub_intake_records"("hubPointId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "hub_intake_records_parcelBookingId_hubPointId_status_idx" ON "hub_intake_records"("parcelBookingId", "hubPointId", "status");

-- CreateIndex
CREATE INDEX "hub_intake_records_deliveryLegId_hubPointId_idx" ON "hub_intake_records"("deliveryLegId", "hubPointId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_delivery_assignments_idempotencyKey_key" ON "partner_delivery_assignments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "partner_delivery_assignments_deliveryLegId_status_idx" ON "partner_delivery_assignments"("deliveryLegId", "status");

-- CreateIndex
CREATE INDEX "partner_delivery_assignments_partnerId_status_assignedAt_idx" ON "partner_delivery_assignments"("partnerId", "status", "assignedAt");

-- CreateIndex
CREATE INDEX "partner_delivery_assignments_agreementId_status_idx" ON "partner_delivery_assignments"("agreementId", "status");

-- CreateIndex
CREATE INDEX "custody_handovers_parcelBookingId_initiatedAt_idx" ON "custody_handovers"("parcelBookingId", "initiatedAt");

-- CreateIndex
CREATE INDEX "custody_handovers_deliveryLegId_status_initiatedAt_idx" ON "custody_handovers"("deliveryLegId", "status", "initiatedAt");

-- CreateIndex
CREATE INDEX "custody_handovers_hubPointId_status_initiatedAt_idx" ON "custody_handovers"("hubPointId", "status", "initiatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "operational_cases_publicReference_key" ON "operational_cases"("publicReference");

-- CreateIndex
CREATE INDEX "operational_cases_status_priority_createdAt_idx" ON "operational_cases"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "operational_cases_parcelBookingId_status_idx" ON "operational_cases"("parcelBookingId", "status");

-- CreateIndex
CREATE INDEX "operational_cases_deliveryLegId_status_idx" ON "operational_cases"("deliveryLegId", "status");

-- CreateIndex
CREATE INDEX "operational_cases_partnerId_status_idx" ON "operational_cases"("partnerId", "status");

-- CreateIndex
CREATE INDEX "operational_cases_hubPointId_status_idx" ON "operational_cases"("hubPointId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payables_partnerDeliveryAssignmentId_key" ON "partner_payables"("partnerDeliveryAssignmentId");

-- CreateIndex
CREATE INDEX "partner_payables_partnerId_status_generatedAt_idx" ON "partner_payables"("partnerId", "status", "generatedAt");

-- CreateIndex
CREATE INDEX "partner_payables_agreementId_generatedAt_idx" ON "partner_payables"("agreementId", "generatedAt");

-- CreateIndex
CREATE INDEX "partner_payables_deliveryLegId_idx" ON "partner_payables"("deliveryLegId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payable_adjustments_idempotencyKey_key" ON "partner_payable_adjustments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "partner_payable_adjustments_payableId_createdAt_idx" ON "partner_payable_adjustments"("payableId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_payable_adjustments_approvedAt_appliedAt_idx" ON "partner_payable_adjustments"("approvedAt", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_batches_reference_key" ON "partner_settlement_batches"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_batches_idempotencyKey_key" ON "partner_settlement_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "partner_settlement_batches_partnerId_currency_status_period_idx" ON "partner_settlement_batches"("partnerId", "currency", "status", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_batch_items_payableId_key" ON "partner_settlement_batch_items"("payableId");

-- CreateIndex
CREATE INDEX "partner_settlement_batch_items_batchId_idx" ON "partner_settlement_batch_items"("batchId");

-- CreateIndex
CREATE INDEX "partner_settlement_reconciliations_batchId_createdAt_idx" ON "partner_settlement_reconciliations"("batchId", "createdAt");

-- AddForeignKey
ALTER TABLE "auth_action_tokens" ADD CONSTRAINT "auth_action_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_settlement_accounts" ADD CONSTRAINT "driver_settlement_accounts_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "states" ADD CONSTRAINT "states_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lgas" ADD CONSTRAINT "lgas_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_zones" ADD CONSTRAINT "service_zones_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_zones" ADD CONSTRAINT "service_zones_lgaId_stateId_fkey" FOREIGN KEY ("lgaId", "stateId") REFERENCES "lgas"("id", "stateId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_availability" ADD CONSTRAINT "service_availability_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_coverage" ADD CONSTRAINT "driver_coverage_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_coverage" ADD CONSTRAINT "driver_coverage_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_points" ADD CONSTRAINT "hub_points_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_bookings" ADD CONSTRAINT "parcel_bookings_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_bookings" ADD CONSTRAINT "parcel_bookings_pickupServiceZoneId_fkey" FOREIGN KEY ("pickupServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_bookings" ADD CONSTRAINT "parcel_bookings_destinationServiceZoneId_fkey" FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_bookings" ADD CONSTRAINT "ride_bookings_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_bookings" ADD CONSTRAINT "ride_bookings_pickupServiceZoneId_fkey" FOREIGN KEY ("pickupServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_bookings" ADD CONSTRAINT "ride_bookings_destinationServiceZoneId_fkey" FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_originServiceZoneId_fkey" FOREIGN KEY ("originServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_destinationServiceZoneId_fkey" FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_originHubPointId_fkey" FOREIGN KEY ("originHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_destinationHubPointId_fkey" FOREIGN KEY ("destinationHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_leg_offers" ADD CONSTRAINT "delivery_leg_offers_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_leg_offers" ADD CONSTRAINT "delivery_leg_offers_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_driverSettlementAccountId_fkey" FOREIGN KEY ("driverSettlementAccountId") REFERENCES "driver_settlement_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "driver_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_rate_cards" ADD CONSTRAINT "partner_rate_cards_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_rates" ADD CONSTRAINT "partner_rates_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "partner_rate_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_rates" ADD CONSTRAINT "partner_rates_originServiceZoneId_fkey" FOREIGN KEY ("originServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_rates" ADD CONSTRAINT "partner_rates_destinationServiceZoneId_fkey" FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_quotes" ADD CONSTRAINT "shipment_quotes_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_quotes" ADD CONSTRAINT "shipment_quotes_partnerAgreementId_fkey" FOREIGN KEY ("partnerAgreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_quotes" ADD CONSTRAINT "shipment_quotes_partnerRateId_fkey" FOREIGN KEY ("partnerRateId") REFERENCES "partner_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_quotes" ADD CONSTRAINT "shipment_quotes_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_audit_events" ADD CONSTRAINT "operational_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_partner_members" ADD CONSTRAINT "transport_partner_members_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_partner_members" ADD CONSTRAINT "transport_partner_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_point_operators" ADD CONSTRAINT "hub_point_operators_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_point_operators" ADD CONSTRAINT "hub_point_operators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_intake_records" ADD CONSTRAINT "hub_intake_records_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_intake_records" ADD CONSTRAINT "hub_intake_records_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_intake_records" ADD CONSTRAINT "hub_intake_records_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_intake_records" ADD CONSTRAINT "hub_intake_records_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_delivery_assignments" ADD CONSTRAINT "partner_delivery_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_handovers" ADD CONSTRAINT "custody_handovers_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_custodyHandoverId_fkey" FOREIGN KEY ("custodyHandoverId") REFERENCES "custody_handovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_partnerDeliveryAssignmentId_fkey" FOREIGN KEY ("partnerDeliveryAssignmentId") REFERENCES "partner_delivery_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payable_adjustments" ADD CONSTRAINT "partner_payable_adjustments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "partner_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payable_adjustments" ADD CONSTRAINT "partner_payable_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payable_adjustments" ADD CONSTRAINT "partner_payable_adjustments_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_batches" ADD CONSTRAINT "partner_settlement_batches_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_batches" ADD CONSTRAINT "partner_settlement_batches_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_batches" ADD CONSTRAINT "partner_settlement_batches_reconciledByUserId_fkey" FOREIGN KEY ("reconciledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_batch_items" ADD CONSTRAINT "partner_settlement_batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "partner_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_batch_items" ADD CONSTRAINT "partner_settlement_batch_items_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "partner_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_reconciliations" ADD CONSTRAINT "partner_settlement_reconciliations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "partner_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_reconciliations" ADD CONSTRAINT "partner_settlement_reconciliations_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


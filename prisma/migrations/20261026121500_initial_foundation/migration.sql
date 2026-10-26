-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'DRIVER', 'HUB_OPERATOR', 'SUPPORT', 'ADMIN');

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
CREATE TYPE "VerificationAction" AS ENUM ('PARCEL_PICKUP', 'PARCEL_DELIVERY', 'RIDE_PICKUP');

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
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
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
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" TEXT NOT NULL,
    "parcelBookingId" TEXT,
    "rideBookingId" TEXT,
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
    "openingHours" JSONB,
    "acceptedParcelTypes" JSONB,
    "capacityConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_points_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

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
CREATE INDEX "pricing_rules_serviceType_isActive_effectiveFrom_idx" ON "pricing_rules"("serviceType", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "pricing_rules_serviceZoneId_serviceType_isActive_idx" ON "pricing_rules"("serviceZoneId", "serviceType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_bookings_publicReference_key" ON "parcel_bookings"("publicReference");

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
CREATE INDEX "ride_bookings_passengerId_createdAt_idx" ON "ride_bookings"("passengerId", "createdAt");

-- CreateIndex
CREATE INDEX "ride_bookings_pickupServiceZoneId_status_createdAt_idx" ON "ride_bookings"("pickupServiceZoneId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ride_bookings_destinationServiceZoneId_status_createdAt_idx" ON "ride_bookings"("destinationServiceZoneId", "status", "createdAt");

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
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_parcelBookingId_action_status_idx" ON "verification_tokens"("parcelBookingId", "action", "status");

-- CreateIndex
CREATE INDEX "verification_tokens_rideBookingId_action_status_idx" ON "verification_tokens"("rideBookingId", "action", "status");

-- CreateIndex
CREATE INDEX "verification_tokens_status_expiresAt_idx" ON "verification_tokens"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "booking_events_parcelBookingId_createdAt_idx" ON "booking_events"("parcelBookingId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_events_rideBookingId_createdAt_idx" ON "booking_events"("rideBookingId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_events_actorUserId_createdAt_idx" ON "booking_events"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "hub_points_serviceZoneId_status_idx" ON "hub_points"("serviceZoneId", "status");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

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
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_rideBookingId_fkey" FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_points" ADD CONSTRAINT "hub_points_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supplemental PostgreSQL integrity constraints.
-- Immutable initial-constraint snapshot, applied as part of the initial Prisma migration.
-- Keep this file and the migration suffix identical; CI validates this invariant.
-- Add future integrity changes through new timestamped migrations, not by rewriting this snapshot.

-- A polymorphic booking reference must point to exactly one booking type.
ALTER TABLE "driver_offers"
  ADD CONSTRAINT "driver_offers_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1),
  ADD CONSTRAINT "driver_offers_positive_proposed_fare"
  CHECK ("proposedFareMinor" IS NULL OR "proposedFareMinor" > 0);

ALTER TABLE "driver_assignments"
  ADD CONSTRAINT "driver_assignments_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1);

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1);

ALTER TABLE "driver_payouts"
  ADD CONSTRAINT "driver_payouts_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1);

ALTER TABLE "verification_tokens"
  ADD CONSTRAINT "verification_tokens_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1);

ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1);

-- Ledger entries may be platform-level entries with neither booking reference,
-- but must never refer to both parcel and ride bookings at once.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_at_most_one_booking_type"
  CHECK (NOT ("parcelBookingId" IS NOT NULL AND "rideBookingId" IS NOT NULL));

-- One live assignment per booking and one live job per driver.
CREATE UNIQUE INDEX "driver_assignments_one_active_parcel_booking"
  ON "driver_assignments" ("parcelBookingId")
  WHERE "parcelBookingId" IS NOT NULL
    AND status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');

CREATE UNIQUE INDEX "driver_assignments_one_active_ride_booking"
  ON "driver_assignments" ("rideBookingId")
  WHERE "rideBookingId" IS NOT NULL
    AND status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');

CREATE UNIQUE INDEX "driver_assignments_one_active_job_per_driver"
  ON "driver_assignments" ("driverProfileId")
  WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');

-- Monetary values and accepted-quote snapshots.
ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_positive_amount"
  CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "payment_attempts_nonnegative_provider_fee"
  CHECK ("providerFeeMinor" IS NULL OR "providerFeeMinor" >= 0),
  ADD CONSTRAINT "payment_attempts_valid_split_allocations"
  CHECK (
    (
      "driverAllocationMinor" IS NULL
      AND "platformAllocationMinor" IS NULL
      AND "driverSettlementAccountId" IS NULL
      AND "splitConfigurationSnapshot" IS NULL
    )
    OR
    (
      "driverAllocationMinor" IS NOT NULL
      AND "platformAllocationMinor" IS NOT NULL
      AND "driverSettlementAccountId" IS NOT NULL
      AND "splitConfigurationSnapshot" IS NOT NULL
      AND "driverAllocationMinor" >= 0
      AND "platformAllocationMinor" >= 0
      AND "driverAllocationMinor" + "platformAllocationMinor" = "amountMinor"
    )
  );

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_positive_amount"
  CHECK ("amountMinor" > 0);

ALTER TABLE "driver_payouts"
  ADD CONSTRAINT "driver_payouts_positive_amount"
  CHECK ("amountMinor" > 0);

ALTER TABLE "driver_assignments"
  ADD CONSTRAINT "driver_assignments_positive_agreed_fare"
  CHECK ("agreedFareMinor" > 0),
  ADD CONSTRAINT "driver_assignments_payment_expiry_required"
  CHECK (status <> 'AWAITING_PAYMENT' OR "paymentExpiresAt" IS NOT NULL);

ALTER TABLE "service_availability"
  ADD CONSTRAINT "service_availability_valid_window"
  CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "driver_profiles"
  ADD CONSTRAINT "driver_profiles_positive_service_radius"
  CHECK ("serviceRadiusMeters" > 0),
  ADD CONSTRAINT "driver_profiles_nonnegative_job_counts"
  CHECK ("completedJobs" >= 0 AND "cancelledJobs" >= 0),
  ADD CONSTRAINT "driver_profiles_rating_range"
  CHECK ("averageRating" IS NULL OR "averageRating" BETWEEN 0 AND 5);

ALTER TABLE "driver_locations"
  ADD CONSTRAINT "driver_locations_nonnegative_accuracy"
  CHECK ("accuracyMeters" IS NULL OR "accuracyMeters" >= 0);

ALTER TABLE "pricing_rules"
  ADD CONSTRAINT "pricing_rules_nonnegative_amounts"
  CHECK (
    "fixedConnectionFeeMinor" >= 0
    AND "minimumDriverFareMinor" >= 0
    AND "baseFareMinor" >= 0
    AND "perKmMinor" >= 0
    AND "perMinuteMinor" >= 0
  ),
  ADD CONSTRAINT "pricing_rules_positive_version"
  CHECK ("version" > 0),
  ADD CONSTRAINT "pricing_rules_valid_effective_window"
  CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_valid_amount_snapshot"
  CHECK (
    "connectionFeeMinor" >= 0
    AND "otherChargesMinor" >= 0
    AND ("declaredValueMinor" IS NULL OR "declaredValueMinor" >= 0)
    AND (
      ("driverFareMinor" IS NULL AND "customerPayableMinor" IS NULL)
      OR
      (
        "driverFareMinor" IS NOT NULL
        AND "customerPayableMinor" IS NOT NULL
        AND "driverFareMinor" > 0
        AND "customerPayableMinor" =
          "driverFareMinor" + "connectionFeeMinor" + "otherChargesMinor"
      )
    )
  );

ALTER TABLE "ride_bookings"
  ADD CONSTRAINT "ride_bookings_valid_amount_snapshot"
  CHECK (
    "connectionFeeMinor" >= 0
    AND (
      ("driverFareMinor" IS NULL AND "customerPayableMinor" IS NULL)
      OR
      (
        "driverFareMinor" IS NOT NULL
        AND "customerPayableMinor" IS NOT NULL
        AND "driverFareMinor" > 0
        AND "customerPayableMinor" = "driverFareMinor" + "connectionFeeMinor"
      )
    )
  );

-- Validate coordinates regardless of which client or provider supplied them.
ALTER TABLE "driver_locations"
  ADD CONSTRAINT "driver_locations_valid_latitude"
  CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "driver_locations_valid_longitude"
  CHECK ("longitude" BETWEEN -180 AND 180);

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_valid_pickup_latitude"
  CHECK ("pickupLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "parcel_bookings_valid_pickup_longitude"
  CHECK ("pickupLongitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "parcel_bookings_valid_destination_latitude"
  CHECK ("destinationLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "parcel_bookings_valid_destination_longitude"
  CHECK ("destinationLongitude" BETWEEN -180 AND 180);

ALTER TABLE "ride_bookings"
  ADD CONSTRAINT "ride_bookings_valid_pickup_latitude"
  CHECK ("pickupLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "ride_bookings_valid_pickup_longitude"
  CHECK ("pickupLongitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "ride_bookings_valid_destination_latitude"
  CHECK ("destinationLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "ride_bookings_valid_destination_longitude"
  CHECK ("destinationLongitude" BETWEEN -180 AND 180);

ALTER TABLE "hub_points"
  ADD CONSTRAINT "hub_points_valid_latitude"
  CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "hub_points_valid_longitude"
  CHECK ("longitude" BETWEEN -180 AND 180);

ALTER TABLE "driver_settlement_accounts"
  ADD CONSTRAINT "driver_settlement_accounts_currency_code_length"
  CHECK (char_length("currency") = 3);

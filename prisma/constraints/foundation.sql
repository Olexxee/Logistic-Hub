-- Supplemental PostgreSQL integrity constraints.
-- Apply only AFTER generating/applying the base schema from prisma/schema.prisma.
-- This file is validated in CI against a disposable PostgreSQL database.
-- It is not yet a standalone Prisma migration; the reviewed initial migration must
-- include the generated base schema plus these constraints before any deployment.

-- A polymorphic booking reference must point to exactly one booking type.
ALTER TABLE "driver_offers"
  ADD CONSTRAINT "driver_offers_exactly_one_booking"
  CHECK (("parcelBookingId" IS NOT NULL)::int + ("rideBookingId" IS NOT NULL)::int = 1);

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
  ADD CONSTRAINT "driver_assignments_nonnegative_agreed_fare"
  CHECK ("agreedFareMinor" >= 0);

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
        AND "driverFareMinor" >= 0
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
        AND "driverFareMinor" >= 0
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

-- Allow an accepted partner shipment quote to lock a customer total
-- without misrepresenting partner transport charges as a direct driver fare.
ALTER TABLE "parcel_bookings"
  DROP CONSTRAINT "parcel_bookings_valid_amount_snapshot";

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_valid_amount_snapshot"
  CHECK (
    "connectionFeeMinor" >= 0
    AND "otherChargesMinor" >= 0
    AND ("declaredValueMinor" IS NULL OR "declaredValueMinor" >= 0)
    AND (
      (
        "driverFareMinor" IS NULL
        AND "customerPayableMinor" IS NULL
      )
      OR
      (
        "driverFareMinor" IS NOT NULL
        AND "customerPayableMinor" IS NOT NULL
        AND "driverFareMinor" > 0
        AND "customerPayableMinor" =
          "driverFareMinor" + "connectionFeeMinor" + "otherChargesMinor"
      )
      OR
      (
        "driverFareMinor" IS NULL
        AND "customerPayableMinor" IS NOT NULL
        AND "customerPayableMinor" > 0
        AND "pricingSnapshot" ? 'quoteId'
        AND "pricingSnapshot" ? 'totalCustomerChargeMinor'
        AND "pricingSnapshot"->>'totalCustomerChargeMinor' ~ '^(0|[1-9][0-9]*)$'
        AND "customerPayableMinor"::numeric =
          ("pricingSnapshot"->>'totalCustomerChargeMinor')::numeric
      )
    )
  );

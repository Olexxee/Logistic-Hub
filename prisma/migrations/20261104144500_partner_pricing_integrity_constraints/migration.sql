-- Partner pricing integrity rules.
-- Keep the accepted quote snapshot as a valid pricing source when no driver fare exists.

ALTER TABLE "partner_rates"
  ADD CONSTRAINT "partner_rates_valid_weight_band"
  CHECK (
    "minWeightGrams" >= 0
    AND ("maxWeightGrams" IS NULL OR "maxWeightGrams" > "minWeightGrams")
  );

ALTER TABLE "parcel_bookings"
  DROP CONSTRAINT "parcel_bookings_valid_amount_snapshot",
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
        AND "pricingSnapshot" ? 'quoteId'
        AND COALESCE("pricingSnapshot"->>'quoteId', '') <> ''
        AND "pricingSnapshot"->>'currency' = "currency"
        AND CASE
          WHEN COALESCE("pricingSnapshot"->>'totalCustomerChargeMinor', '') ~ '^(0|[1-9][0-9]*)$'
          THEN ("pricingSnapshot"->>'totalCustomerChargeMinor')::bigint = "customerPayableMinor"
          ELSE false
        END
      )
    )
  );


ALTER TABLE "shipment_quotes"
  ADD CONSTRAINT "shipment_quotes_valid_charge_totals"
  CHECK (
    "transportChargeMinor" > 0
    AND "collectionChargeMinor" >= 0
    AND "hubHandlingChargeMinor" >= 0
    AND "destinationDeliveryChargeMinor" >= 0
    AND "platformChargeMinor" >= 0
    AND "otherChargesMinor" >= 0
    AND "totalCustomerChargeMinor" =
      "transportChargeMinor"
      + "collectionChargeMinor"
      + "hubHandlingChargeMinor"
      + "destinationDeliveryChargeMinor"
      + "platformChargeMinor"
      + "otherChargesMinor"
  );

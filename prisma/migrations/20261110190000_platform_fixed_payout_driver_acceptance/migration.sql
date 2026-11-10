ALTER TABLE "delivery_leg_offers"
ADD COLUMN "fixedPayoutMinor" BIGINT;

ALTER TABLE "delivery_leg_offers"
ADD CONSTRAINT "delivery_leg_offers_fixedPayoutMinor_positive_check"
CHECK ("fixedPayoutMinor" IS NULL OR "fixedPayoutMinor" > 0);

ALTER TABLE "delivery_leg_offers"
ADD CONSTRAINT "delivery_leg_offers_fixed_or_proposed_fare_check"
CHECK ("fixedPayoutMinor" IS NULL OR "proposedFareMinor" IS NULL);

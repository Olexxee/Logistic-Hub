ALTER TABLE "delivery_leg_offers"
ADD COLUMN "fixedPayoutMinor" BIGINT;

ALTER TABLE "delivery_leg_offers"
ADD CONSTRAINT "delivery_leg_offers_fixedPayoutMinor_nonnegative_check"
CHECK ("fixedPayoutMinor" IS NULL OR "fixedPayoutMinor" >= 0);

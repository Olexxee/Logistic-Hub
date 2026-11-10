ALTER TABLE "integration_quote_options"
  ALTER COLUMN "partnerAgreementId" DROP NOT NULL,
  ALTER COLUMN "partnerRateCardId" DROP NOT NULL,
  ADD COLUMN "driverPayoutMinor" BIGINT;

ALTER TABLE "integration_quote_options"
  ADD CONSTRAINT "integration_quote_options_driver_payout_check"
  CHECK ("driverPayoutMinor" IS NULL OR "driverPayoutMinor" >= 0);

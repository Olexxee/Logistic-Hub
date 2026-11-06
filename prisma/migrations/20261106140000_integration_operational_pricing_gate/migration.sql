-- GIL-04A: keep integration quote sessions unquotable when the operational route
-- contains local driver legs that do not yet have a fixed contracted price.
ALTER TYPE "IntegrationQuoteSessionStatus" ADD VALUE 'REQUIRES_OPERATIONAL_PRICING';

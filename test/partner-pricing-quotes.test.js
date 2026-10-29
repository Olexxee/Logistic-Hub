import test from "node:test";
import assert from "node:assert/strict";
import { buildPartnerRateEligibilityWhere, getRateCardPublishBlocker, isPositiveMinorAmount } from "../src/modules/partner-pricing/partner-pricing.routes.js";

test("transport charge must be a positive integer minor-unit amount", () => {
  assert.equal(isPositiveMinorAmount("1"), true);
  assert.equal(isPositiveMinorAmount(1200n), true);
  assert.equal(isPositiveMinorAmount("0"), false);
  assert.equal(isPositiveMinorAmount("-1"), false);
  assert.equal(isPositiveMinorAmount("12.5"), false);
  assert.equal(isPositiveMinorAmount("1000000000000000"), false);
});

test("partner rate selection is restricted to the booking route and parcel category", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  const where = buildPartnerRateEligibilityWhere({
    pickupServiceZoneId: "zone-lagos-mainland",
    destinationServiceZoneId: "zone-lagos-island",
    parcelCategory: "DOCUMENTS",
  }, now);

  assert.equal(where.isActive, true);
  assert.equal(where.originServiceZoneId, "zone-lagos-mainland");
  assert.equal(where.destinationServiceZoneId, "zone-lagos-island");
  assert.equal(where.serviceType, "PARCEL_DELIVERY");
  assert.equal(where.parcelCategory, "DOCUMENTS");
  assert.equal(where.rateCard.status, "ACTIVE");
  assert.deepEqual(where.rateCard.effectiveFrom, { lte: now });
  assert.equal(where.rateCard.agreement.status, "ACTIVE");
  assert.deepEqual(where.rateCard.agreement.partner, {
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
  });
});

test("rate-card publication requires an active verified partner, active agreement, dates, and rates", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  const eligible = {
    status: "DRAFT",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveUntil: null,
    agreement: {
      status: "ACTIVE",
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      effectiveUntil: null,
      partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
    },
    rates: [{ id: "rate-1" }],
  };

  assert.equal(getRateCardPublishBlocker(eligible, now), null);
  assert.equal(getRateCardPublishBlocker({ ...eligible, status: "ACTIVE" }, now), "NOT_DRAFT");
  assert.equal(getRateCardPublishBlocker({
    ...eligible,
    agreement: { ...eligible.agreement, partner: { status: "PENDING", verificationStatus: "VERIFIED" } },
  }, now), "PARTNER_AGREEMENT_INELIGIBLE");
  assert.equal(getRateCardPublishBlocker({
    ...eligible,
    effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
  }, now), "OUTSIDE_EFFECTIVE_DATES");
  assert.equal(getRateCardPublishBlocker({ ...eligible, rates: [] }, now), "NO_ACTIVE_RATES");
});

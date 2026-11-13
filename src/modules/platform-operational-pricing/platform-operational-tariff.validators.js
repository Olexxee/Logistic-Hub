import { z } from "zod";
import { isCanonicalPlatformRouteWeightBand } from "../platform-route-pricing/platform-route-weight-bands.js";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(5).max(1000);
const currency = z.string().trim().length(3).transform(value => value.toUpperCase());
const amount = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const positiveAmount = z.string().regex(/^[1-9][0-9]{0,14}$/);
const dimensions = {
  maxLengthMm: z.number().int().positive().optional(),
  maxWidthMm: z.number().int().positive().optional(),
  maxHeightMm: z.number().int().positive().optional(),
};

const locatorFields = {
  scope: z.enum(["LOCAL_ZONE", "HUB_PAIR", "HUB_HANDLING"]),
  serviceType: z.literal("PARCEL_DELIVERY").default("PARCEL_DELIVERY"),
  serviceZoneId: id.optional(),
  legType: z.enum(["LOCAL_PICKUP", "FINAL_MILE", "INTERSTATE_TRANSPORT"]).optional(),
  originHubPointId: id.optional(),
  destinationHubPointId: id.optional(),
  hubPointId: id.optional(),
  operationType: z.enum(["SPECIAL_SORTING", "REPACKAGING"]).optional(),
};

function validLocator(value, ctx) {
  const fail = (field, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  if (value.scope === "LOCAL_ZONE") {
    if (!value.serviceZoneId) fail("serviceZoneId", "A service zone is required for LOCAL_ZONE.");
    if (!["LOCAL_PICKUP", "FINAL_MILE"].includes(value.legType)) fail("legType", "LOCAL_ZONE requires LOCAL_PICKUP or FINAL_MILE.");
    if (value.originHubPointId || value.destinationHubPointId || value.hubPointId || value.operationType) fail("scope", "LOCAL_ZONE cannot contain hub or handling locators.");
  } else if (value.scope === "HUB_PAIR") {
    if (!value.originHubPointId) fail("originHubPointId", "An origin hub is required for HUB_PAIR.");
    if (!value.destinationHubPointId) fail("destinationHubPointId", "A destination hub is required for HUB_PAIR.");
    if (value.originHubPointId && value.originHubPointId === value.destinationHubPointId) fail("destinationHubPointId", "Hub-pair direction endpoints must differ.");
    if (value.legType !== "INTERSTATE_TRANSPORT") fail("legType", "HUB_PAIR requires INTERSTATE_TRANSPORT.");
    if (value.serviceZoneId || value.hubPointId || value.operationType) fail("scope", "HUB_PAIR cannot contain local-zone or handling locators.");
  } else {
    if (!value.hubPointId) fail("hubPointId", "A handling hub is required for HUB_HANDLING.");
    if (!value.operationType) fail("operationType", "An explicit additional operation type is required for HUB_HANDLING.");
    if (value.serviceZoneId || value.legType || value.originHubPointId || value.destinationHubPointId) fail("scope", "HUB_HANDLING cannot contain zone or hub-pair locators.");
  }
}

export const tariffListSchema = z.object({
  scope: z.enum(["LOCAL_ZONE", "HUB_PAIR", "HUB_HANDLING"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]).optional(),
  serviceZoneId: id.optional(),
  legType: z.enum(["LOCAL_PICKUP", "FINAL_MILE", "INTERSTATE_TRANSPORT"]).optional(),
  originHubPointId: id.optional(),
  destinationHubPointId: id.optional(),
  hubPointId: id.optional(),
  operationType: z.enum(["SPECIAL_SORTING", "REPACKAGING"]).optional(),
  parcelCategory: z.string().trim().min(2).max(80).optional(),
}).strict();

export const tariffSchema = z.object({
  ...locatorFields,
  parcelCategory: z.string().trim().min(2).max(80),
  minWeightGrams: z.number().int().positive(),
  maxWeightGrams: z.number().int().positive(),
  ...dimensions,
  currency: currency.default("NGN"),
  customerChargeMinor: positiveAmount,
  platformChargeMinor: amount.default("0"),
  effectiveFrom: z.coerce.date().default(() => new Date()),
  effectiveUntil: z.coerce.date().nullable().optional(),
  reason,
}).strict()
  .superRefine((value, ctx) => {
    validLocator(value, ctx);
    if (!isCanonicalPlatformRouteWeightBand(value.minWeightGrams, value.maxWeightGrams)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minWeightGrams"], message: "Select one of the seven canonical weight bands from 1 g to 30,000 g." });
    }
    if (value.effectiveUntil && value.effectiveUntil <= value.effectiveFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveUntil"], message: "effectiveUntil must be later than effectiveFrom." });
    }
  });

export const availabilityListSchema = z.object({
  scope: z.enum(["LOCAL_ZONE", "HUB_PAIR", "HUB_HANDLING"]).optional(),
  serviceZoneId: id.optional(),
  legType: z.enum(["LOCAL_PICKUP", "FINAL_MILE", "INTERSTATE_TRANSPORT"]).optional(),
  originHubPointId: id.optional(),
  destinationHubPointId: id.optional(),
  hubPointId: id.optional(),
  operationType: z.enum(["SPECIAL_SORTING", "REPACKAGING"]).optional(),
  serviceType: z.literal("PARCEL_DELIVERY").optional(),
}).strict();

export const availabilitySchema = z.object({
  ...locatorFields,
  isEnabled: z.boolean(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  reason,
}).strict()
  .superRefine((value, ctx) => {
    validLocator(value, ctx);
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "endsAt must be later than startsAt." });
    }
  });

export const reasonSchema = z.object({ reason }).strict();
export const tariffIdSchema = z.object({ tariffId: id }).strict();

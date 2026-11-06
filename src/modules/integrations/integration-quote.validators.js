import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const coordinates = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

const packageSchema = z.object({
  externalPackageRef: z.string().trim().min(1).max(100).optional(),
  packageCategory: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  weightGrams: z.number().int().positive().max(100_000_000).optional(),
  lengthMm: z.number().int().positive().max(1_000_000).optional(),
  widthMm: z.number().int().positive().max(1_000_000).optional(),
  heightMm: z.number().int().positive().max(1_000_000).optional(),
  declaredValueMinor: z.string().regex(/^(0|[1-9][0-9]{0,14})$/).optional(),
}).strict();

export const integrationQuoteCreateSchema = z.object({
  billingAgreementReference: z.string().trim().min(2).max(80),
  externalReference: z.string().trim().min(1).max(128),
  pickupServiceZoneId: id,
  destinationServiceZoneId: id,
  pickupAddress: z.string().trim().min(3).max(500),
  pickup: coordinates,
  destinationAddress: z.string().trim().min(3).max(500),
  destination: coordinates,
  recipientName: z.string().trim().min(1).max(160),
  recipientPhone: z.string().trim().min(7).max(32),
  packages: z.array(packageSchema).min(1).max(50),
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
}).strict().superRefine((input, ctx) => {
  const refs = input.packages.map(pkg => pkg.externalPackageRef).filter(Boolean);
  if (new Set(refs).size !== refs.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packages"], message: "externalPackageRef values must be unique within the consignment." });
  }
});

export const integrationQuoteParamsSchema = z.object({ quoteSessionId: id }).strict();
export const integrationQuoteOptionParamsSchema = z.object({ quoteSessionId: id, optionId: id }).strict();

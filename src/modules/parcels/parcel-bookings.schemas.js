import { z } from "zod";

const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

const minorAmountSchema = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const packageSchema = z.object({
  externalPackageRef: z.string().trim().min(1).max(128).optional(),
  packageCategory: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional(),
  weightGrams: z.number().int().positive().max(1_000_000).optional(),
  lengthMm: z.number().int().positive().max(100_000).optional(),
  widthMm: z.number().int().positive().max(100_000).optional(),
  heightMm: z.number().int().positive().max(100_000).optional(),
  declaredValueMinor: minorAmountSchema.optional(),
}).strict().superRefine((pkg, ctx) => {
  const dimensions = [pkg.lengthMm, pkg.widthMm, pkg.heightMm];
  const suppliedDimensions = dimensions.filter(value => value != null).length;
  if (suppliedDimensions !== 0 && suppliedDimensions !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide length, width and height together, or omit all three.",
      path: ["lengthMm"],
    });
  }
});

export const createParcelBookingSchema = z.object({
  // Optional compatibility hints only; the backend resolves authoritative zones from coordinates.
  pickupServiceZoneId: z.string().trim().min(1).max(128).optional(),
  destinationServiceZoneId: z.string().trim().min(1).max(128).optional(),
  pickupAddress: z.string().trim().min(3).max(500),
  pickup: coordinatesSchema,
  pickupInstructions: z.string().trim().max(1000).optional(),
  destinationAddress: z.string().trim().min(3).max(500),
  destination: coordinatesSchema,
  recipientName: z.string().trim().min(1).max(160),
  recipientPhone: z.string().trim().min(7).max(32),
  // Legacy single-package fields remain accepted during the client migration.
  parcelCategory: z.string().trim().min(1).max(80).optional(),
  parcelDescription: z.string().trim().max(2000).optional(),
  parcelSize: z.string().trim().min(1).max(80).optional(),
  weightGrams: z.number().int().positive().max(1_000_000).optional(),
  lengthMm: z.number().int().positive().max(100_000).optional(),
  widthMm: z.number().int().positive().max(100_000).optional(),
  heightMm: z.number().int().positive().max(100_000).optional(),
  declaredValueMinor: minorAmountSchema.optional(),
  // Canonical package representation for new clients; package assessment is server-owned.
  packages: z.array(packageSchema).min(1).max(10).optional(),
  handlingInstructions: z.string().trim().max(1000).optional(),
}).strict().superRefine((booking, ctx) => {
  if (!booking.packages && (!booking.parcelCategory || !booking.parcelSize)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide legacy parcelCategory and parcelSize or at least one package.",
      path: ["packages"],
    });
  }
  if (booking.packages && (
    booking.parcelCategory || booking.parcelDescription || booking.parcelSize
    || booking.weightGrams != null || booking.lengthMm != null
    || booking.widthMm != null || booking.heightMm != null || booking.declaredValueMinor
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use either packages or legacy single-package fields, not both.",
      path: ["packages"],
    });
  }
  const dimensions = [booking.lengthMm, booking.widthMm, booking.heightMm];
  const suppliedDimensions = dimensions.filter(value => value != null).length;
  if (!booking.packages && suppliedDimensions !== 0 && suppliedDimensions !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide length, width and height together, or omit all three.",
      path: ["lengthMm"],
    });
  }
});

export const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

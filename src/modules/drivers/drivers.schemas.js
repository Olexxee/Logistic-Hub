import { z } from "zod";

export const driverOnboardingSchema = z.object({
  serviceRadiusMeters: z.number().int().min(500).max(100000).default(5000),
  vehicle: z.object({
    type: z.enum(["BICYCLE", "MOTORCYCLE", "CAR", "VAN", "PICKUP", "TRUCK"]),
    make: z.string().trim().max(80).optional(),
    model: z.string().trim().max(80).optional(),
    registrationPlate: z.string().trim().min(2).max(32).optional(),
    parcelCapacity: z.string().trim().max(80).optional(),
  }).strict(),
}).strict();

export const driverAvailabilitySchema = z.object({
  isOnline: z.boolean(),
  isAvailable: z.boolean(),
}).strict().refine((value) => !value.isAvailable || value.isOnline, {
  message: "A driver must be online to mark themselves available.",
  path: ["isAvailable"],
});

export const driverLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(10000).optional(),
}).strict();

export const driverVerificationSchema = z.object({
  verificationStatus: z.enum(["VERIFIED", "REJECTED"]),
}).strict();

export const vehicleVerificationSchema = z.object({
  verificationStatus: z.enum(["VERIFIED", "REJECTED"]),
}).strict();

export const driverCoverageSchema = z.object({
  driverProfileId: z.string().trim().min(1).max(128),
  serviceZoneId: z.string().trim().min(1).max(128),
  serviceType: z.enum(["PARCEL_DELIVERY", "PASSENGER_RIDE", "HUB_POINT", "BUSINESS_LOGISTICS"]),
  isEnabled: z.boolean(),
}).strict();

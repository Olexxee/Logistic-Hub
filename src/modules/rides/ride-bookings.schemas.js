import { z } from "zod";

const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

export const createRideBookingSchema = z.object({
  pickupServiceZoneId: z.string().trim().min(1).max(128),
  destinationServiceZoneId: z.string().trim().min(1).max(128),
  pickupAddress: z.string().trim().min(3).max(500),
  pickup: coordinatesSchema,
  destinationAddress: z.string().trim().min(3).max(500),
  destination: coordinatesSchema,
  vehicleType: z.enum(["BICYCLE", "MOTORCYCLE", "CAR", "VAN", "PICKUP", "TRUCK"]),
}).strict();

export const rideIdempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

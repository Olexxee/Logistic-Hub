import { z } from "zod";

export const proposeFareSchema = z.object({
  vehicleId: z.string().trim().min(1).max(128).optional(),
  proposedFareMinor: z.string().regex(/^[1-9][0-9]{0,14}$/),
}).strict();

export const acceptFareSchema = z.object({
  offerId: z.string().trim().min(1).max(128),
}).strict();

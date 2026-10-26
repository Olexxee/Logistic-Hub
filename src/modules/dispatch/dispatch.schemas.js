import { z } from "zod";

export const proposeFareSchema = z.object({
  proposedFareMinor: z.string().regex(/^[1-9][0-9]{0,14}$/),
}).strict();

export const acceptFareSchema = z.object({
  offerId: z.string().trim().min(1).max(128),
}).strict();

export const listDriverOffersQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

import { z } from "zod";

export const integrationShipmentEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).max(2147483646).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

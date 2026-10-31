import { z } from "zod";

export const createTicketSchema = z.object({
  bookingType: z.enum(["PARCEL", "RIDE"]).optional(),
  bookingId: z.string().trim().min(1).max(128).optional(),
  category: z.enum(["PAYMENT", "DELIVERY", "DRIVER", "ACCOUNT", "REFUND", "OTHER"]),
  subject: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(5000),
}).strict();

export const updateTicketSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  resolution: z.string().trim().min(5).max(5000).optional(),
  assignedToUserId: z.string().trim().min(1).max(128).nullable().optional(),
}).strict();

export const listTicketsQuerySchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  category: z.enum(["PAYMENT", "DELIVERY", "DRIVER", "ACCOUNT", "REFUND", "OTHER"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().trim().min(1).max(128).optional(),
  unassignedOnly: z.enum(["true", "false"]).optional(),
  q: z.string().trim().min(2).max(120).optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((value, context) => {
  if (value.unassignedOnly === "true" && value.assignedToUserId) {
    context.addIssue({ code: "custom", path: ["assignedToUserId"], message: "Do not combine assignedToUserId with unassignedOnly=true." });
  }
});

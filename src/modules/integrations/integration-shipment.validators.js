import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const minorAmount = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);

export const integrationShipmentCreateSchema = z.object({
  quoteSessionId: id,
  quoteOptionId: id,
  externalFulfillmentReference: z.string().trim().min(1).max(128),
  paymentAttestation: z.object({
    paymentProvider: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/),
    externalPaymentReference: z.string().trim().min(1).max(128),
    verifiedAt: z.string().datetime({ offset: true }),
    currency: z.string().regex(/^[A-Z]{3}$/),
    deliveryChargeMinor: minorAmount,
    orderPaymentAmountMinor: minorAmount.optional(),
  }).strict(),
}).strict();

export const integrationShipmentDispatchAuthorizationSchema = z.object({
  reason: z.enum(["BUYER_APPROVED", "REVIEW_TIMEOUT"]),
}).strict();

export const integrationShipmentPackingEvidenceFreezeSchema = z.object({}).strict();

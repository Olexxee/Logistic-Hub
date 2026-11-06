import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(5).max(500);
const scopes = z.array(z.string().trim().min(3).max(80)).max(30).default([]);

export const integrationClientListQuerySchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]).optional(),
  search: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const integrationClientCreateSchema = z.object({
  code: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(2).max(120),
  reason,
  scopes,
  metadata: z.record(z.unknown()).optional(),
}).strict();

export const integrationClientParamsSchema = z.object({ clientId: id }).strict();
export const integrationCredentialParamsSchema = z.object({ credentialId: id }).strict();

export const integrationClientStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
  reason,
}).strict();

export const integrationCredentialCreateSchema = z.object({
  label: z.string().trim().min(2).max(80),
  expiresAt: z.coerce.date().optional(),
  reason,
}).strict();

export const integrationCredentialRevokeSchema = z.object({ reason }).strict();

export const integrationAgreementCreateSchema = z.object({
  reference: z.string().trim().min(2).max(80),
  billingModel: z.enum(["PLATFORM_COLLECTED", "LOGISTIC_HUB_COLLECTED", "PREPAID_ACCOUNT", "INVOICE"]),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
  terms: z.record(z.unknown()).optional(),
  reason,
}).strict().refine(value => !value.effectiveUntil || !value.effectiveFrom || value.effectiveUntil > value.effectiveFrom, {
  message: "effectiveUntil must be later than effectiveFrom",
  path: ["effectiveUntil"],
});

export const integrationBillingAgreementParamsSchema = z.object({ clientId: id, agreementId: id }).strict();
export const integrationBillingAgreementStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "REVOKED"]),
  reason,
}).strict();

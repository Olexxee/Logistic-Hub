import { z } from "zod";

export const integrationPackingEvidenceParamsSchema = z.object({
  externalFulfillmentReference: z.string().trim().min(1).max(128),
}).strict();

export const integrationPackingEvidenceIdParamsSchema = z.object({
  evidenceId: z.string().trim().min(1).max(128),
}).strict();

export const PACKING_EVIDENCE_SLOTS = Object.freeze([
  "CONTENTS_OVERVIEW",
  "PRODUCT_DETAILS",
  "QUANTITY_CHECK",
  "SEALED_PARCEL",
]);

export function validatePackingEvidenceHeaders(headers) {
  const slot = String(headers["x-evidence-slot"] ?? "").trim();
  const actorReference = String(headers["x-evidence-actor-reference"] ?? "").trim();
  const mimeType = String(headers["x-file-content-type"] ?? "").trim().toLowerCase();
  const originalName = String(headers["x-file-name"] ?? "").trim();
  const idempotencyKey = String(headers["idempotency-key"] ?? "").trim();
  if (!PACKING_EVIDENCE_SLOTS.includes(slot)) {
    const error = new Error("A valid packing evidence slot is required.");
    error.statusCode = 400;
    error.code = "INVALID_PACKING_EVIDENCE_SLOT";
    throw error;
  }
  if (!actorReference || actorReference.length > 128) {
    const error = new Error("A valid evidence actor reference is required.");
    error.statusCode = 400;
    error.code = "INVALID_PACKING_EVIDENCE_ACTOR";
    throw error;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    const error = new Error("Only JPEG, PNG, and WebP packing evidence is accepted.");
    error.statusCode = 415;
    error.code = "PACKING_EVIDENCE_TYPE_UNSUPPORTED";
    throw error;
  }
  if (!originalName || originalName.length > 160) {
    const error = new Error("A valid evidence filename is required.");
    error.statusCode = 400;
    error.code = "INVALID_PACKING_EVIDENCE_FILENAME";
    throw error;
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    const error = new Error("A valid Idempotency-Key header (8–128 characters) is required.");
    error.statusCode = 400;
    error.code = "INVALID_IDEMPOTENCY_KEY";
    throw error;
  }
  return { slot, actorReference, mimeType, originalName, idempotencyKey };
}

export const integrationPackingEvidenceDownloadParamsSchema = integrationPackingEvidenceParamsSchema.extend({
  evidenceId: z.string().trim().min(1).max(128),
}).strict();

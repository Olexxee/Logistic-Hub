import { getAuditContext } from "./audit-context.js";

const HUMAN_REQUIRED_FIELDS = ["actorUserId", "entityType", "entityId", "action"];
const COMMON_REQUIRED_FIELDS = ["entityType", "entityId", "action"];

/**
 * Persist an operational audit event through an interactive Prisma transaction.
 * Human events require an authenticated actor. System events require an explicit
 * source and are stored with a null actorUserId (the schema permits this).
 */
export async function writeOperationalAuditEvent(tx, event) {
  if (!tx?.operationalAuditEvent?.create || typeof tx.$transaction === "function") {
    throw new TypeError("An interactive Prisma transaction client is required.");
  }

  const actorType = event?.actorType ?? "HUMAN";
  const requiredFields = actorType === "SYSTEM" ? COMMON_REQUIRED_FIELDS : HUMAN_REQUIRED_FIELDS;
  for (const field of requiredFields) {
    if (typeof event?.[field] !== "string" || !event[field].trim()) {
      throw new TypeError(`Audit event ${field} is required.`);
    }
  }

  if (!["HUMAN", "SYSTEM"].includes(actorType)) {
    throw new TypeError("Audit event actorType must be HUMAN or SYSTEM.");
  }

  if (actorType === "SYSTEM") {
    if (event.actorUserId != null) {
      throw new TypeError("System audit events cannot claim a human actor.");
    }
    if (typeof event.systemSource !== "string" || !event.systemSource.trim()) {
      throw new TypeError("System audit events require systemSource.");
    }
  }

  const requestId = getAuditContext()?.requestId ?? null;
  const suppliedMetadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata
    : {};
  const metadata = {
    ...suppliedMetadata,
    ...(actorType === "SYSTEM" ? { actorType: "SYSTEM", systemSource: event.systemSource } : {}),
    ...(requestId ? { requestId } : {}),
  };


  return tx.operationalAuditEvent.create({
    data: {
      actorUserId: actorType === "SYSTEM" ? null : event.actorUserId,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      reason: event.reason ?? null,
      before: event.before ?? undefined,
      after: event.after ?? undefined,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    },
  });
}

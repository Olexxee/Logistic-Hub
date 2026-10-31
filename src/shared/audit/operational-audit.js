const REQUIRED_FIELDS = ["actorUserId", "entityType", "entityId", "action"];

/**
 * Persist an operational audit event using the caller's transaction client.
 * Callers must pass the same Prisma transaction used for the domain mutation.
 */
export async function writeOperationalAuditEvent(tx, event) {
  if (!tx?.operationalAuditEvent?.create) {
    throw new TypeError("A Prisma transaction client with operationalAuditEvent.create is required.");
  }
  for (const field of REQUIRED_FIELDS) {
    if (typeof event?.[field] !== "string" || !event[field].trim()) {
      throw new TypeError(`Audit event ${field} is required.`);
    }
  }
  return tx.operationalAuditEvent.create({
    data: {
      actorUserId: event.actorUserId,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      reason: event.reason ?? null,
      before: event.before ?? undefined,
      after: event.after ?? undefined,
      metadata: event.metadata ?? undefined,
    },
  });
}

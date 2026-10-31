const REQUIRED_FIELDS = ["actorUserId", "entityType", "entityId", "action"];

/**
 * Persist an operational audit event through an interactive Prisma transaction.
 * A root PrismaClient exposes $transaction; the interactive transaction client does not.
 */
export async function writeOperationalAuditEvent(tx, event) {
  if (!tx?.operationalAuditEvent?.create || typeof tx.$transaction === "function") {
    throw new TypeError("An interactive Prisma transaction client is required.");
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

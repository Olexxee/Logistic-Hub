import { encryptJobPayload } from "./outbox-crypto.js";

const EMAIL_TOPIC = "email.send";

export function createOutboxService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function enqueueEmailInTransaction(tx, message, idempotencyKey) {
    if (!message?.to || !message?.subject || (!message?.html && !message?.text)) {
      throw new TypeError("A valid email message is required.");
    }
    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      throw new TypeError("An email idempotency key is required.");
    }

    const encryptedPayload = encryptJobPayload(message);
    return tx.outboxJob.upsert({
      where: { idempotencyKey },
      create: {
        topic: EMAIL_TOPIC,
        encryptedPayload,
        idempotencyKey,
        status: "PENDING",
        availableAt: clock(),
      },
      update: {},
      select: { id: true, status: true },
    });
  }

  return Object.freeze({
    enqueueEmailInTransaction,
    async enqueueEmail(message, idempotencyKey) {
      return prismaClient.$transaction((tx) => enqueueEmailInTransaction(tx, message, idempotencyKey));
    },
  });
}

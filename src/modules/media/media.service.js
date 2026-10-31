import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createFirebaseStorage } from "./firebase-storage.js";
import { NotFoundError, ValidationError } from "../../shared/http/app-error.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", { extension: ".jpg", signature: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: ".png", signature: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: ".webp", signature: buffer => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }],
  ["application/pdf", { extension: ".pdf", signature: buffer => buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-" }],
]);
const STAFF_ROLES = new Set(["ADMIN", "SUPPORT"]);

function safeOriginalName(value) {
  const name = basename(String(value ?? "evidence").replace(/[\u0000-\u001f\u007f]/g, "")).trim();
  return (name || "evidence").slice(0, 160);
}
function canAccessTicket(ticket, user) {
  return STAFF_ROLES.has(user.role) || ticket.customerId === user.id;
}
function publicAsset(asset) {
  return {
    id: asset.id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes.toString(),
    createdAt: asset.createdAt,
    uploadedBy: asset.uploadedBy,
  };
}

export function createMediaService({ prismaClient, storage = createFirebaseStorage() }) {
  async function findAccessibleTicket(ticketId, user) {
    const ticket = await prismaClient.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || !canAccessTicket(ticket, user)) throw new NotFoundError("Support ticket not found.");
    return ticket;
  }

  return {
    async listTicketAttachments({ ticketId, user }) {
      await findAccessibleTicket(ticketId, user);
      const attachments = await prismaClient.supportTicketAttachment.findMany({
        where: { ticketId, mediaAsset: { deletedAt: null } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          createdAt: true,
          mediaAsset: {
            select: {
              id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true,
              uploadedBy: { select: { id: true, fullName: true } },
            },
          },
        },
      });
      return attachments.map(item => ({ attachmentId: item.id, ...publicAsset(item.mediaAsset) }));
    },

    async uploadTicketAttachment({ ticketId, user, buffer, mimeType, originalName }) {
      const ticket = await findAccessibleTicket(ticketId, user);
      if (ticket.status === "CLOSED") throw new ValidationError("Evidence cannot be added to a closed support ticket.");
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ValidationError("A non-empty file is required.");
      if (buffer.length > MAX_FILE_BYTES) throw new ValidationError("Evidence files must not exceed 10 MB.");
      const type = ALLOWED_TYPES.get(String(mimeType ?? "").toLowerCase());
      if (!type || !type.signature(buffer)) throw new ValidationError("Only valid JPEG, PNG, WebP, and PDF evidence files are accepted.");
      const name = safeOriginalName(originalName);
      const objectPath = `support-tickets/${ticketId}/${randomUUID()}${type.extension}`;
      const sha256 = createHash("sha256").update(buffer).digest("hex");

      await storage.upload({ objectPath, buffer, mimeType });
      try {
        const created = await prismaClient.$transaction(async tx => {
          const asset = await tx.mediaAsset.create({
            data: {
              storageProvider: "FIREBASE",
              bucket: storage.bucket,
              objectPath,
              originalName: name,
              mimeType,
              sizeBytes: BigInt(buffer.length),
              sha256,
              uploadedById: user.id,
            },
          });
          const attachment = await tx.supportTicketAttachment.create({
            data: { ticketId, mediaAssetId: asset.id },
          });
          await writeOperationalAuditEvent(tx, {
            actorUserId: user.id,
            entityType: "SUPPORT_TICKET",
            entityId: ticketId,
            action: "SUPPORT_TICKET_EVIDENCE_UPLOADED",
            metadata: { attachmentId: attachment.id, mediaAssetId: asset.id, mimeType, sizeBytes: buffer.length, sha256 },
          });
          return { attachmentId: attachment.id, ...publicAsset({ ...asset, uploadedBy: { id: user.id, fullName: user.fullName } }) };
        });
        return created;
      } catch (error) {
        await storage.delete({ objectPath }).catch(() => {});
        throw error;
      }
    },

    async downloadTicketAttachment({ ticketId, attachmentId, user }) {
      await findAccessibleTicket(ticketId, user);
      const attachment = await prismaClient.supportTicketAttachment.findFirst({
        where: { id: attachmentId, ticketId, mediaAsset: { deletedAt: null } },
        include: { mediaAsset: true },
      });
      if (!attachment) throw new NotFoundError("Evidence attachment not found.");
      const buffer = await storage.download({ objectPath: attachment.mediaAsset.objectPath });
      await prismaClient.$transaction(async tx => {
        await writeOperationalAuditEvent(tx, {
          actorUserId: user.id,
          entityType: "SUPPORT_TICKET",
          entityId: ticketId,
          action: "SUPPORT_TICKET_EVIDENCE_DOWNLOADED",
          metadata: { attachmentId, mediaAssetId: attachment.mediaAssetId },
        });
      });
      return {
        buffer,
        mimeType: attachment.mediaAsset.mimeType,
        originalName: attachment.mediaAsset.originalName,
      };
    },
  };
}

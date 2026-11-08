import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createCloudinaryStorage } from "../media/cloudinary-storage.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MIME = {
  "image/jpeg": { extension: ".jpg", valid: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { extension: ".png", valid: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  "image/webp": { extension: ".webp", valid: b => b.length >= 12 && b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP" },
};
const safeName = value => basename(String(value).replace(/[\u0000-\u001f\u007f]/g, "")).trim().slice(0,160) || "packing-evidence";
const hash = value => createHash("sha256").update(value).digest("hex");
const present = row => ({
  id: row.id, slot: row.slot, version: row.version, actorReference: row.actorReference,
  originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes.toString(),
  sha256: row.sha256, uploadedAt: row.uploadedAt,
});

export function createIntegrationPackingEvidenceService({ prismaClient, storage = createCloudinaryStorage(), clock = () => new Date() } = {}) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function findBooking(clientId, externalFulfillmentReference) {
    const mapping = await prismaClient.integrationExternalReference.findFirst({
      where: { clientId, resourceType: "SHIPMENT", externalReference: externalFulfillmentReference,
        internalResourceType: "ParcelBooking" },
      select: { internalResourceId: true },
    });
    if (!mapping) throw new NotFoundError("Shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
    const booking = await prismaClient.parcelBooking.findFirst({
      where: { id: mapping.internalResourceId, integrationClientId: clientId, senderId: null },
      select: { id: true, publicReference: true },
    });
    if (!booking) throw new NotFoundError("Shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
    return booking;
  }

  return {
    async upload({ client, externalFulfillmentReference, metadata, buffer }) {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_BYTES) {
        throw new ValidationError("Packing evidence must be a non-empty image no larger than 5 MB.");
      }
      const type = MIME[metadata.mimeType];
      if (!type || !type.valid(buffer)) throw new ValidationError("The uploaded bytes do not match the declared JPEG, PNG, or WebP type.");
      const booking = await findBooking(client.id, externalFulfillmentReference);
      const sha256 = hash(buffer);
      const payloadHash = hash(JSON.stringify({
        externalFulfillmentReference, slot: metadata.slot, actorReference: metadata.actorReference,
        originalName: safeName(metadata.originalName), mimeType: metadata.mimeType, sha256,
      }));
      const objectPath = `integration-packing-evidence/${client.id}/${booking.id}/${metadata.slot.toLowerCase()}/${randomUUID()}${type.extension}`;
      const storedPath = await storage.upload({ objectPath, buffer, mimeType: metadata.mimeType }) ?? objectPath;
      try {
        const result = await prismaClient.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "parcel_bookings" WHERE "id" = ${booking.id} FOR UPDATE`;
          const replay = await tx.integrationPackingEvidence.findUnique({
            where: { clientId_idempotencyKey: { clientId: client.id, idempotencyKey: metadata.idempotencyKey } },
          });
          if (replay) {
            if (replay.payloadHash !== payloadHash) throw new ConflictError("The Idempotency-Key was reused with different evidence.", "IDEMPOTENCY_CONFLICT");
            return { evidence: replay, replay: true };
          }
          const latest = await tx.integrationPackingEvidence.aggregate({
            where: { parcelBookingId: booking.id, slot: metadata.slot },
            _max: { version: true },
          });
          const evidence = await tx.integrationPackingEvidence.create({
            data: {
              clientId: client.id, parcelBookingId: booking.id, slot: metadata.slot,
              version: (latest._max.version ?? 0) + 1, idempotencyKey: metadata.idempotencyKey,
              payloadHash, actorReference: metadata.actorReference, originalName: safeName(metadata.originalName),
              mimeType: metadata.mimeType, sizeBytes: BigInt(buffer.length), sha256,
              storageProvider: storage.provider ?? "CLOUDINARY", bucket: storage.bucket,
              objectPath: storedPath, uploadedAt: clock(),
            },
          });
          return { evidence, replay: false };
        }, { isolationLevel: "Serializable" });
        if (result.replay) await storage.delete({ objectPath: storedPath, mimeType: metadata.mimeType }).catch(() => {});
        return { ...present(result.evidence), replay: result.replay, shipmentReference: booking.publicReference };
      } catch (error) {
        await storage.delete({ objectPath: storedPath, mimeType: metadata.mimeType }).catch(() => {});
        throw error;
      }
    },

    async list({ client, externalFulfillmentReference }) {
      const booking = await findBooking(client.id, externalFulfillmentReference);
      const rows = await prismaClient.integrationPackingEvidence.findMany({
        where: { clientId: client.id, parcelBookingId: booking.id },
        orderBy: [{ slot: "asc" }, { version: "asc" }],
      });
      return { shipmentReference: booking.publicReference, evidence: rows.map(present) };
    },

    async download({ client, evidenceId }) {
      const row = await prismaClient.integrationPackingEvidence.findFirst({
        where: { id: evidenceId, clientId: client.id },
      });
      if (!row) throw new NotFoundError("Packing evidence not found.", "PACKING_EVIDENCE_NOT_FOUND");
      const buffer = await storage.download({ objectPath: row.objectPath, mimeType: row.mimeType });
      if (buffer.length !== Number(row.sizeBytes) || hash(buffer) !== row.sha256) {
        throw new ConflictError("Stored packing evidence failed its integrity check.", "PACKING_EVIDENCE_INTEGRITY_FAILED");
      }
      return { buffer, mimeType: row.mimeType, originalName: row.originalName };
    },
  };
}

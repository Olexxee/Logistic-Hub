import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createCloudinaryStorage } from "../media/cloudinary-storage.js";
import { createFirebaseStorage } from "../media/firebase-storage.js";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../../shared/http/app-error.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", { extension: ".jpg", signature: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/png", { extension: ".png", signature: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) }],
  ["image/webp", { extension: ".webp", signature: b => b.length >= 12 && b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP" }],
  ["application/pdf", { extension: ".pdf", signature: b => b.length >= 5 && b.subarray(0,5).toString("ascii") === "%PDF-" }],
]);
const DOCUMENT_TYPES = new Set(["IDENTITY","DRIVER_LICENSE","VEHICLE_REGISTRATION","VEHICLE_INSURANCE","ROADWORTHINESS"]);
function safeName(value) { return (basename(String(value ?? "driver-document").replace(/[\u0000-\u001f\u007f]/g,"")).trim() || "driver-document").slice(0,160); }

export function createDriverDocumentsService({ prismaClient, storage = createCloudinaryStorage(), legacyStorage = createFirebaseStorage() }) {
  async function ownProfile(userId) {
    const profile = await prismaClient.driverProfile.findUnique({ where: { userId }, select: { id: true, userId: true } });
    if (!profile) throw new NotFoundError("Driver profile not found. Complete onboarding first.");
    return profile;
  }
  async function documentById(id) {
    const document = await prismaClient.driverVerificationDocument.findUnique({
      where: { id },
      include: {
        mediaAsset: true,
        driverProfile: { select: { id: true, userId: true, verificationStatus: true, kycTier: true, suspendedAt: true, user: { select: { fullName: true, email: true, phone: true } } } },
        vehicle: { select: { id: true, type: true, registrationPlate: true, verificationStatus: true } },
      },
    });
    if (!document) throw new NotFoundError("Driver verification document not found.");
    return document;
  }
  function serialize(item) {
    return {
      id: item.id, driverProfileId: item.driverProfileId, vehicleId: item.vehicleId,
      documentType: item.documentType, reviewStatus: item.reviewStatus, reviewReason: item.reviewReason,
      reviewedAt: item.reviewedAt, expiresAt: item.expiresAt, createdAt: item.createdAt,
      originalName: item.mediaAsset.originalName, mimeType: item.mediaAsset.mimeType,
      sizeBytes: item.mediaAsset.sizeBytes.toString(), uploadedBy: item.mediaAsset.uploadedBy,
      driver: item.driverProfile ? {
        userId: item.driverProfile.userId, fullName: item.driverProfile.user.fullName,
        email: item.driverProfile.user.email, phone: item.driverProfile.user.phone,
        verificationStatus: item.driverProfile.verificationStatus, kycTier: item.driverProfile.kycTier,
        suspendedAt: item.driverProfile.suspendedAt,
      } : undefined,
      vehicle: item.vehicle ?? null,
    };
  }
  return {
    async listMine({ user }) {
      const profile = await ownProfile(user.id);
      const items = await prismaClient.driverVerificationDocument.findMany({
        where: { driverProfileId: profile.id },
        include: { mediaAsset: { select: { originalName: true, mimeType: true, sizeBytes: true } }, vehicle: { select: { id: true, type: true, registrationPlate: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return items.map(serialize);
    },
    async uploadMine({ user, buffer, mimeType, originalName, documentType, vehicleId }) {
      const profile = await ownProfile(user.id);
      if (!DOCUMENT_TYPES.has(documentType)) throw new ValidationError("Unsupported driver verification document type.");
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ValidationError("A non-empty document file is required.");
      if (buffer.length > MAX_FILE_BYTES) throw new ValidationError("Driver documents must not exceed 10 MB.");
      const normalizedMime = String(mimeType ?? "").toLowerCase();
      const fileType = ALLOWED_TYPES.get(normalizedMime);
      if (!fileType || !fileType.signature(buffer)) throw new ValidationError("Only valid JPEG, PNG, WebP, and PDF documents are accepted.");
      const isVehicleDocument = documentType.startsWith("VEHICLE_") || documentType === "ROADWORTHINESS";
      if (isVehicleDocument && !vehicleId) throw new ValidationError("A vehicle ID is required for vehicle documents.");
      if (!isVehicleDocument && vehicleId) throw new ValidationError("Identity and driver-license documents must be attached to the driver profile.");
      if (vehicleId && !await prismaClient.vehicle.findFirst({ where: { id: vehicleId, driverProfileId: profile.id }, select: { id: true } })) {
        throw new NotFoundError("Vehicle not found for this driver profile.");
      }
      const objectPath = `driver-verification/${profile.id}/${randomUUID()}${fileType.extension}`;
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const storedPath = await storage.upload({ objectPath, buffer, mimeType: normalizedMime }) ?? objectPath;
      try {
        const created = await prismaClient.$transaction(async tx => {
          const asset = await tx.mediaAsset.create({ data: {
            storageProvider: storage.provider ?? "CLOUDINARY", bucket: storage.bucket, objectPath: storedPath,
            originalName: safeName(originalName), mimeType: normalizedMime, sizeBytes: BigInt(buffer.length),
            sha256, uploadedById: user.id,
          } });
          const document = await tx.driverVerificationDocument.create({
            data: { driverProfileId: profile.id, vehicleId: vehicleId ?? null, mediaAssetId: asset.id, documentType, reviewStatus: "PENDING" },
            include: { mediaAsset: { select: { originalName: true, mimeType: true, sizeBytes: true } }, vehicle: { select: { id: true, type: true, registrationPlate: true } } },
          });
          await writeOperationalAuditEvent(tx, {
            actorUserId: user.id, entityType: "DRIVER_PROFILE", entityId: profile.id,
            action: "DRIVER_VERIFICATION_DOCUMENT_UPLOADED",
            metadata: { documentId: document.id, mediaAssetId: asset.id, vehicleId: vehicleId ?? null, documentType, mimeType: normalizedMime, sizeBytes: buffer.length, sha256 },
          });
          return document;
        });
        return { id: created.id, vehicleId: created.vehicleId, documentType: created.documentType, reviewStatus: created.reviewStatus, createdAt: created.createdAt, originalName: created.mediaAsset.originalName, mimeType: created.mediaAsset.mimeType, sizeBytes: created.mediaAsset.sizeBytes.toString(), vehicle: created.vehicle };
      } catch (error) {
        await storage.delete({ objectPath: storedPath, mimeType: normalizedMime }).catch(() => {});
        throw error;
      }
    },
    async listForAdmin({ page, limit, reviewStatus, driverProfileId, vehicleId }) {
      const where = { ...(reviewStatus ? { reviewStatus } : {}), ...(driverProfileId ? { driverProfileId } : {}), ...(vehicleId ? { vehicleId } : {}) };
      const [items,total] = await Promise.all([
        prismaClient.driverVerificationDocument.findMany({
          where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page-1)*limit, take: limit,
          include: {
            mediaAsset: { select: { originalName: true, mimeType: true, sizeBytes: true, uploadedBy: { select: { id: true, fullName: true } } } },
            driverProfile: { select: { id: true, userId: true, verificationStatus: true, kycTier: true, suspendedAt: true, user: { select: { fullName: true, email: true, phone: true } } } },
            vehicle: { select: { id: true, type: true, registrationPlate: true, verificationStatus: true } },
          },
        }),
        prismaClient.driverVerificationDocument.count({ where }),
      ]);
      return { items: items.map(serialize), page, limit, total, totalPages: Math.ceil(total/limit) };
    },
    async reviewDocument({ documentId, reviewStatus, reason, actorUserId }) {
      return prismaClient.$transaction(async tx => {
        const current = await tx.driverVerificationDocument.findUnique({ where: { id: documentId }, select: { id: true, driverProfileId: true, vehicleId: true, documentType: true, reviewStatus: true, reviewReason: true } });
        if (!current) return null;
        if (current.reviewStatus !== "PENDING") throw new ConflictError("Only pending documents can be reviewed.", "DRIVER_DOCUMENT_NOT_REVIEWABLE");
        const updated = await tx.driverVerificationDocument.update({
          where: { id: documentId },
          data: { reviewStatus, reviewReason: reason, reviewedAt: new Date(), reviewedById: actorUserId },
          select: { id: true, driverProfileId: true, vehicleId: true, documentType: true, reviewStatus: true, reviewReason: true, reviewedAt: true },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "DRIVER_PROFILE", entityId: current.driverProfileId,
          action: reviewStatus === "APPROVED" ? "DRIVER_VERIFICATION_DOCUMENT_APPROVED" : "DRIVER_VERIFICATION_DOCUMENT_REJECTED",
          reason, before: { documentId, reviewStatus: current.reviewStatus, reviewReason: current.reviewReason },
          after: { documentId, reviewStatus: updated.reviewStatus, reviewReason: updated.reviewReason },
          metadata: { vehicleId: current.vehicleId, documentType: current.documentType },
        });
        return updated;
      });
    },
    async downloadDocument({ documentId, user }) {
      const document = await documentById(documentId);
      if (user.role !== "ADMIN" && document.driverProfile.userId !== user.id) throw new NotFoundError("Driver verification document not found.");
      const asset = document.mediaAsset;
      const provider = asset.storageProvider === "FIREBASE" ? legacyStorage : storage;
      const buffer = await provider.download({ objectPath: asset.objectPath, mimeType: asset.mimeType });
      await prismaClient.$transaction(tx => writeOperationalAuditEvent(tx, {
        actorUserId: user.id, entityType: "DRIVER_PROFILE", entityId: document.driverProfileId,
        action: "DRIVER_VERIFICATION_DOCUMENT_DOWNLOADED",
        metadata: { documentId, mediaAssetId: asset.id, reviewStatus: document.reviewStatus },
      }));
      return { buffer, mimeType: asset.mimeType, originalName: asset.originalName };
    },
  };
}

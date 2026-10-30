import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export function createPartnerApiAuth({ prismaClient = prisma, clock = () => new Date() } = {}) {
  return async function partnerApiAuth(req, res, next) {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer (lhp_[A-Za-z0-9_-]{40,})$/.exec(header);
    if (!match) return res.status(401).json({ success: false, error: { code: "PARTNER_UNAUTHENTICATED", message: "A valid partner API credential is required." } });
    const tokenHash = createHash("sha256").update(match[1]).digest("hex");
    try {
      const credential = await prismaClient.partnerApiCredential.findUnique({
        where: { tokenHash },
        include: { partner: { select: { id: true, displayName: true, status: true, verificationStatus: true } } },
      });
      const now = clock();
      if (!credential || credential.revokedAt || (credential.expiresAt && credential.expiresAt <= now)
        || credential.partner.status !== "ACTIVE" || credential.partner.verificationStatus !== "VERIFIED") {
        return res.status(401).json({ success: false, error: { code: "PARTNER_UNAUTHENTICATED", message: "The partner credential is invalid, expired or revoked." } });
      }
      await prismaClient.partnerApiCredential.update({ where: { id: credential.id }, data: { lastUsedAt: now } });
      req.partner = credential.partner;
      req.partnerCredentialId = credential.id;
      return next();
    } catch (error) { return next(error); }
  };
}

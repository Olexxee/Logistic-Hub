import { createPartnerPricingAdminRepository } from "./partner-pricing.admin.repository.js";

function audit(tx, { actorUserId, entityType, entityId, action, reason = null, before = null, after = null }) {
  return tx.operationalAuditEvent.create({ data: { actorUserId, entityType, entityId, action, reason, before, after } });
}

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}
function rateCardPublishBlocker(card, now) {
  if (card.status !== "DRAFT") return "NOT_DRAFT";
  const agreement = card.agreement;
  if (agreement.status !== "ACTIVE" || agreement.effectiveFrom > now ||
    (agreement.effectiveUntil && agreement.effectiveUntil <= now) ||
    agreement.partner.status !== "ACTIVE" || agreement.partner.verificationStatus !== "VERIFIED") {
    return "PARTNER_AGREEMENT_INELIGIBLE";
  }
  if (card.effectiveFrom > now || (card.effectiveUntil && card.effectiveUntil <= now)) return "OUTSIDE_EFFECTIVE_DATES";
  if (!card.rates.length) return "NO_ACTIVE_RATES";
  return null;
}

export function createPartnerPricingAdminService({ prismaClient, clock = () => new Date() }) {
  const repository = createPartnerPricingAdminRepository({ prismaClient });
  const transaction = callback => serializableTransaction(prismaClient, callback);
  return {
    async listPartners() { return { items: await repository.listPartners() }; },
    async createPartner({ input, actorUserId }) {
      return transaction(async tx => {
        const partner = await tx.transportPartner.create({ data: input });
        await audit(tx, { actorUserId, entityType: "TRANSPORT_PARTNER", entityId: partner.id, action: "PARTNER_CREATED", after: { status: partner.status, verificationStatus: partner.verificationStatus, displayName: partner.displayName } });
        return { partner };
      });
    },
    async setPartnerStatus({ partnerId, input, actorUserId }) {
      return transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "transport_partners" WHERE "id" = ${partnerId} FOR UPDATE`;
        const current = await tx.transportPartner.findUnique({ where: { id: partnerId } });
        if (!current) return { notFound: true };
        if (current.status === "CLOSED" && input.status !== "CLOSED") return { blocker: "PARTNER_CLOSED" };
        const nextVerification = input.verificationStatus ?? current.verificationStatus;
        if (input.status === "ACTIVE" && nextVerification !== "VERIFIED") return { blocker: "PARTNER_NOT_VERIFIED" };
        if (input.status === "CLOSED" && current.status !== "CLOSED") {
          const [activeMembers, activeAgreements, activeAssignments, openPayables, openBatches] = await Promise.all([
            tx.transportPartnerMember.count({ where: { partnerId, isActive: true } }),
            tx.partnerAgreement.count({ where: { partnerId, status: "ACTIVE" } }),
            tx.partnerDeliveryAssignment.count({ where: { partnerId, status: { in: ["ASSIGNED", "ACCEPTED", "IN_TRANSIT"] } } }),
            tx.partnerPayable.count({ where: { partnerId, status: { in: ["PENDING_APPROVAL", "APPROVED", "IN_BATCH", "DISPUTED"] } } }),
            tx.partnerSettlementBatch.count({ where: { partnerId, status: { in: ["DRAFT", "APPROVED", "RECONCILIATION_REQUIRED"] } } }),
          ]);
          if (activeMembers) return { blocker: "ACTIVE_PARTNER_MEMBERS_EXIST" };
          if (activeAgreements) return { blocker: "ACTIVE_PARTNER_AGREEMENTS_EXIST" };
          if (activeAssignments) return { blocker: "ACTIVE_PARTNER_ASSIGNMENTS_EXIST" };
          if (openPayables) return { blocker: "OPEN_PARTNER_PAYABLES_EXIST" };
          if (openBatches) return { blocker: "OPEN_PARTNER_SETTLEMENT_BATCHES_EXIST" };
        }
        const updated = await tx.transportPartner.update({ where: { id: partnerId }, data: {
          status: input.status,
          ...(input.verificationStatus ? { verificationStatus: input.verificationStatus } : {}),
          ...(nextVerification === "VERIFIED" ? { verifiedAt: current.verifiedAt ?? clock() } : { verifiedAt: input.verificationStatus ? null : current.verifiedAt }),
        } });
        await audit(tx, { actorUserId, entityType: "TRANSPORT_PARTNER", entityId: partnerId, action: "PARTNER_STATUS_UPDATED", before: { status: current.status, verificationStatus: current.verificationStatus }, after: { status: updated.status, verificationStatus: updated.verificationStatus } });
        return { partner: updated };
      });
    },
    async createAgreement({ partnerId, input, actorUserId }) {
      return transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "transport_partners" WHERE "id" = ${partnerId} FOR UPDATE`;
        const partner = await tx.transportPartner.findUnique({ where: { id: partnerId }, select: { id: true, status: true } });
        if (!partner) return { notFound: true };
        if (partner.status === "CLOSED") return { blocker: "PARTNER_CLOSED" };
        const agreement = await tx.partnerAgreement.create({ data: {
          partnerId, reference: input.reference, currency: input.currency.toUpperCase(),
          effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil,
          volumeCommitment: input.volumeCommitment, serviceStandards: input.serviceStandards,
          custodyClaimsTerms: input.custodyClaimsTerms, status: "DRAFT",
        } });
        await audit(tx, { actorUserId, entityType: "PARTNER_AGREEMENT", entityId: agreement.id, action: "PARTNER_AGREEMENT_CREATED", after: { partnerId, reference: agreement.reference, status: agreement.status } });
        return { agreement };
      });
    },
    async activateAgreement({ agreementId, actorUserId }) {
      return transaction(async tx => {
        const initial = await tx.partnerAgreement.findUnique({ where: { id: agreementId }, select: { id: true, partnerId: true } });
        if (!initial) return { notFound: true };
        await tx.$queryRaw`SELECT "id" FROM "transport_partners" WHERE "id" = ${initial.partnerId} FOR UPDATE`;
        const agreement = await tx.partnerAgreement.findUnique({ where: { id: agreementId }, include: { partner: true } });
        if (!agreement) return { notFound: true };
        const now = clock();
        if (agreement.status !== "DRAFT") return { blocker: "NOT_DRAFT" };
        if (agreement.partner.status !== "ACTIVE" || agreement.partner.verificationStatus !== "VERIFIED") return { blocker: "PARTNER_NOT_ELIGIBLE" };
        if (agreement.effectiveFrom > now || (agreement.effectiveUntil && agreement.effectiveUntil <= now)) return { blocker: "OUTSIDE_EFFECTIVE_DATES" };
        const existing = await tx.partnerAgreement.findFirst({ where: { partnerId: agreement.partnerId, status: "ACTIVE", id: { not: agreement.id } }, select: { id: true } });
        if (existing) return { blocker: "ACTIVE_AGREEMENT_EXISTS" };
        const updated = await tx.partnerAgreement.update({ where: { id: agreement.id }, data: { status: "ACTIVE", approvedAt: now } });
        await audit(tx, { actorUserId, entityType: "PARTNER_AGREEMENT", entityId: agreement.id, action: "PARTNER_AGREEMENT_ACTIVATED", before: { status: agreement.status }, after: { status: updated.status, approvedAt: now.toISOString() } });
        return { agreement: updated };
      });
    },
    async setAgreementStatus({ agreementId, status, actorUserId }) {
      return transaction(async tx => {
        const initial = await tx.partnerAgreement.findUnique({ where: { id: agreementId }, select: { id: true, partnerId: true } });
        if (!initial) return { notFound: true };
        await tx.$queryRaw`SELECT "id" FROM "transport_partners" WHERE "id" = ${initial.partnerId} FOR UPDATE`;
        const current = await tx.partnerAgreement.findUnique({ where: { id: agreementId } });
        if (!current) return { notFound: true };
        if (["TERMINATED", "EXPIRED"].includes(current.status)) return { blocker: "AGREEMENT_TERMINAL" };
        if (status === "ACTIVE") return { blocker: "USE_ACTIVATION_ENDPOINT" };
        const updated = await tx.partnerAgreement.update({ where: { id: agreementId }, data: { status } });
        await audit(tx, { actorUserId, entityType: "PARTNER_AGREEMENT", entityId: agreementId, action: "PARTNER_AGREEMENT_STATUS_UPDATED", before: { status: current.status }, after: { status: updated.status } });
        return { agreement: updated };
      });
    },
    async createRateCard({ agreementId, input, actorUserId }) {
      return transaction(async tx => {
        const agreement = await tx.partnerAgreement.findUnique({ where: { id: agreementId } });
        if (!agreement) return { notFound: true };
        if (!["DRAFT", "ACTIVE"].includes(agreement.status)) return { blocker: "AGREEMENT_NOT_EDITABLE" };
        const latest = await tx.partnerRateCard.findFirst({ where: { agreementId }, orderBy: { version: "desc" }, select: { version: true } });
        const card = await tx.partnerRateCard.create({ data: {
          agreementId, version: (latest?.version ?? 0) + 1,
          currency: input.currency.toUpperCase(), effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil, status: "DRAFT",
        } });
        await audit(tx, { actorUserId, entityType: "PARTNER_RATE_CARD", entityId: card.id, action: "PARTNER_RATE_CARD_CREATED", after: { agreementId, version: card.version, status: card.status } });
        return { rateCard: card };
      });
    },
    async createRate({ rateCardId, input, actorUserId }) {
      return transaction(async tx => {
        const card = await tx.partnerRateCard.findUnique({ where: { id: rateCardId } });
        if (!card) return { notFound: true };
        if (card.status !== "DRAFT") return { blocker: "RATE_CARD_NOT_DRAFT" };
        const zones = await tx.serviceZone.findMany({ where: { id: { in: [input.originServiceZoneId, input.destinationServiceZoneId] }, isActive: true }, select: { id: true } });
        if (new Set(zones.map(zone => zone.id)).size !== 2) return { blocker: "SERVICE_ZONE_INACTIVE" };
        const rate = await tx.partnerRate.create({ data: { rateCardId, ...input, transportChargeMinor: BigInt(input.transportChargeMinor) } });
        await audit(tx, { actorUserId, entityType: "PARTNER_RATE_CARD", entityId: rateCardId, action: "PARTNER_RATE_ADDED", after: { rateId: rate.id, originServiceZoneId: rate.originServiceZoneId, destinationServiceZoneId: rate.destinationServiceZoneId, transportChargeMinor: rate.transportChargeMinor.toString() } });
        return { rate };
      });
    },
    async publishRateCard({ rateCardId, actorUserId }) {
      return transaction(async tx => {
        const now = clock();
        const card = await tx.partnerRateCard.findUnique({ where: { id: rateCardId }, include: { agreement: { include: { partner: true } }, rates: { where: { isActive: true } } } });
        if (!card) return { notFound: true };
        const blocker = rateCardPublishBlocker(card, now);
        if (blocker) return { blocker };
        await tx.partnerRateCard.updateMany({ where: { agreementId: card.agreementId, status: "ACTIVE", id: { not: card.id } }, data: { status: "RETIRED" } });
        const published = await tx.partnerRateCard.update({ where: { id: card.id }, data: { status: "ACTIVE", publishedAt: now }, select: {
          id: true, agreementId: true, version: true, status: true, currency: true,
          effectiveFrom: true, effectiveUntil: true, publishedAt: true, updatedAt: true,
        } });
        await audit(tx, { actorUserId, entityType: "PARTNER_RATE_CARD", entityId: card.id, action: "PARTNER_RATE_CARD_PUBLISHED", before: { status: card.status }, after: { status: published.status, publishedAt: now.toISOString(), version: published.version } });
        return { rateCard: published };
      });
    },
  };
}

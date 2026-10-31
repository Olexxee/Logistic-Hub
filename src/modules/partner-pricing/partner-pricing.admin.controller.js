import { createPartnerPricingAdminService } from "./partner-pricing.admin.service.js";
import {
  partnerIdSchema, partnerInputSchema, partnerStatusInputSchema, agreementInputSchema,
  agreementStatusInputSchema, rateCardInputSchema, partnerRateInputSchema,
} from "./partner-pricing.admin.validators.js";

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
    details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  } });
}
function failure(res, code, message, status = 409) {
  return res.status(status).json({ success: false, error: { code, message } });
}
function parsedId(req, res, key) {
  const parsed = partnerIdSchema.safeParse(req.params[key]);
  if (!parsed.success) { invalid(res, parsed.error.issues); return null; }
  return parsed.data;
}

export function createPartnerPricingAdminController({ prismaClient }) {
  const service = createPartnerPricingAdminService({ prismaClient });
  return {
    listPartners: async (_req, res, next) => {
      try { return res.status(200).json({ success: true, data: await service.listPartners() }); }
      catch (error) { return next(error); }
    },
    createPartner: async (req, res, next) => {
      const parsed = partnerInputSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try { return res.status(201).json({ success: true, data: await service.createPartner({ input: parsed.data, actorUserId: req.user.id }) }); }
      catch (error) { return next(error); }
    },
    setPartnerStatus: async (req, res, next) => {
      const id = parsedId(req, res, "partnerId"); if (!id) return;
      const parsed = partnerStatusInputSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const result = await service.setPartnerStatus({ partnerId: id, input: parsed.data, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Transport partner not found.", 404);
        const blockers = {
          PARTNER_NOT_VERIFIED: ["PARTNER_NOT_VERIFIED", "A partner must be verified before activation."],
          PARTNER_CLOSED: ["PARTNER_CLOSED", "A closed transport partner cannot be reopened or changed."],
          ACTIVE_PARTNER_MEMBERS_EXIST: ["ACTIVE_PARTNER_MEMBERS_EXIST", "Deactivate all partner memberships before closing this partner."],
          ACTIVE_PARTNER_AGREEMENTS_EXIST: ["ACTIVE_PARTNER_AGREEMENTS_EXIST", "Suspend, expire or terminate active agreements before closing this partner."],
          ACTIVE_PARTNER_ASSIGNMENTS_EXIST: ["ACTIVE_PARTNER_ASSIGNMENTS_EXIST", "Complete or cancel active partner assignments before closing this partner."],
          OPEN_PARTNER_PAYABLES_EXIST: ["OPEN_PARTNER_PAYABLES_EXIST", "Resolve all outstanding partner payables before closing this partner."],
          OPEN_PARTNER_SETTLEMENT_BATCHES_EXIST: ["OPEN_PARTNER_SETTLEMENT_BATCHES_EXIST", "Reconcile or void open settlement batches before closing this partner."],
        };
        if (result.blocker) return failure(res, ...(blockers[result.blocker] ?? [result.blocker, "The partner lifecycle transition is not permitted."]));
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    createAgreement: async (req, res, next) => {
      const id = parsedId(req, res, "partnerId"); if (!id) return;
      const parsed = agreementInputSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const result = await service.createAgreement({ partnerId: id, input: parsed.data, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Transport partner not found.", 404);
        return res.status(201).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    activateAgreement: async (req, res, next) => {
      const id = parsedId(req, res, "agreementId"); if (!id) return;
      try {
        const result = await service.activateAgreement({ agreementId: id, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Partner agreement not found.", 404);
        const errors = {
          NOT_DRAFT: ["AGREEMENT_NOT_DRAFT", "Only draft agreements can be activated."],
          PARTNER_NOT_ELIGIBLE: ["PARTNER_NOT_ELIGIBLE", "The partner must be active and verified."],
          OUTSIDE_EFFECTIVE_DATES: ["AGREEMENT_OUTSIDE_EFFECTIVE_DATES", "The agreement is not currently within its effective dates."],
          ACTIVE_AGREEMENT_EXISTS: ["ACTIVE_AGREEMENT_EXISTS", "This partner already has an active agreement. Suspend or terminate it before activating another."],
        };
        if (result.blocker) return failure(res, ...errors[result.blocker]);
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    setAgreementStatus: async (req, res, next) => {
      const id = parsedId(req, res, "agreementId"); if (!id) return;
      const parsed = agreementStatusInputSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const result = await service.setAgreementStatus({ agreementId: id, status: parsed.data.status, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Partner agreement not found.", 404);
        if (result.blocker === "AGREEMENT_TERMINAL") return failure(res, "AGREEMENT_TERMINAL", "Expired or terminated agreements cannot be changed.");
        if (result.blocker === "USE_ACTIVATION_ENDPOINT") return failure(res, "USE_ACTIVATION_ENDPOINT", "Use the agreement activation endpoint to enforce partner and effective-date checks.");
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    createRateCard: async (req, res, next) => {
      const id = parsedId(req, res, "agreementId"); if (!id) return;
      const parsed = rateCardInputSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const result = await service.createRateCard({ agreementId: id, input: parsed.data, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Partner agreement not found.", 404);
        if (result.blocker) return failure(res, "AGREEMENT_NOT_EDITABLE", "Rate cards can only be drafted under draft or active agreements.");
        return res.status(201).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    createRate: async (req, res, next) => {
      const id = parsedId(req, res, "rateCardId"); if (!id) return;
      const parsed = partnerRateInputSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const result = await service.createRate({ rateCardId: id, input: parsed.data, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Partner rate card not found.", 404);
        if (result.blocker === "RATE_CARD_NOT_DRAFT") return failure(res, "RATE_CARD_NOT_DRAFT", "Rates can only be added to draft rate cards.");
        if (result.blocker === "SERVICE_ZONE_INACTIVE") return failure(res, "SERVICE_ZONE_INACTIVE", "Both route zones must exist and be active.");
        return res.status(201).json({ success: true, data: { rate: { ...result.rate, transportChargeMinor: result.rate.transportChargeMinor.toString() } } });
      } catch (error) { return next(error); }
    },
    publishRateCard: async (req, res, next) => {
      const id = parsedId(req, res, "rateCardId"); if (!id) return;
      try {
        const result = await service.publishRateCard({ rateCardId: id, actorUserId: req.user.id });
        if (result.notFound) return failure(res, "NOT_FOUND", "Partner rate card not found.", 404);
        const errors = {
          NOT_DRAFT: ["RATE_CARD_NOT_DRAFT", "Only draft rate cards can be published."],
          PARTNER_AGREEMENT_INELIGIBLE: ["PARTNER_AGREEMENT_INELIGIBLE", "The partner must be active and verified, and the agreement must be active and in date."],
          OUTSIDE_EFFECTIVE_DATES: ["RATE_CARD_OUTSIDE_EFFECTIVE_DATES", "The rate card is not currently within its effective dates."],
          NO_ACTIVE_RATES: ["RATE_CARD_HAS_NO_ACTIVE_RATES", "Add at least one active rate before publishing this rate card."],
        };
        if (result.blocker) return failure(res, ...errors[result.blocker]);
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
  };
}

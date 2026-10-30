import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPartnerPricingAdminController } from "./partner-pricing.admin.controller.js";

export function createPartnerPricingAdminRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  adminMiddleware = requireRole("ADMIN"),
} = {}) {
  const router = Router();
  const controller = createPartnerPricingAdminController({ prismaClient });
  router.use(authMiddleware, adminMiddleware);
  router.get("/transport-partners", controller.listPartners);
  router.post("/transport-partners", controller.createPartner);
  router.patch("/transport-partners/:partnerId/status", controller.setPartnerStatus);
  router.post("/transport-partners/:partnerId/agreements", controller.createAgreement);
  router.post("/partner-agreements/:agreementId/activate", controller.activateAgreement);
  router.patch("/partner-agreements/:agreementId/status", controller.setAgreementStatus);
  router.post("/partner-agreements/:agreementId/rate-cards", controller.createRateCard);
  router.post("/partner-rate-cards/:rateCardId/rates", controller.createRate);
  router.post("/partner-rate-cards/:rateCardId/publish", controller.publishRateCard);
  return router;
}

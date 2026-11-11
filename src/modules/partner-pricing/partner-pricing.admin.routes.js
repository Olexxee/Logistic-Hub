import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPartnerPricingAdminController } from "./partner-pricing.admin.controller.js";
import { createOperationalTripPricingRouter } from "./operational-trip-pricing.routes.js";

export function createPartnerPricingAdminRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  adminMiddleware = requireRole("ADMIN"),
} = {}) {
  const router = Router();
  const controller = createPartnerPricingAdminController({ prismaClient });
  router.use(authMiddleware, adminMiddleware);
  router.use(createOperationalTripPricingRouter({ prismaClient }));
  router.get("/transport-partners", controller.listPartners);
  router.get("/transport-partners/:partnerId", controller.getPartner);
  router.patch("/transport-partners/:partnerId", controller.updatePartner);
  router.post("/transport-partners", controller.createPartner);
  router.patch("/transport-partners/:partnerId/status", controller.setPartnerStatus);
  router.get("/transport-partners/:partnerId/agreements", controller.listAgreements);
  router.post("/transport-partners/:partnerId/agreements", controller.createAgreement);
  router.get("/partner-agreements/:agreementId", controller.getAgreement);
  router.get("/partner-agreements/:agreementId/rate-cards", controller.listRateCards);
  router.post("/partner-agreements/:agreementId/activate", controller.activateAgreement);
  router.patch("/partner-agreements/:agreementId/status", controller.setAgreementStatus);
  router.post("/partner-agreements/:agreementId/rate-cards", controller.createRateCard);
  router.get("/partner-rate-cards/:rateCardId", controller.getRateCard);
  router.post("/partner-rate-cards/:rateCardId/rates", controller.createRate);
  router.post("/partner-rate-cards/:rateCardId/publish", controller.publishRateCard);
  return router;
}

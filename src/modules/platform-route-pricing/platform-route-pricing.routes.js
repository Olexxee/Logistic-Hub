import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPlatformRoutePricingController } from "./platform-route-pricing.controller.js";

export function createPlatformRoutePricingRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const r = Router();
  const c = createPlatformRoutePricingController({ prismaClient });
  r.use(authMiddleware, roleMiddleware("ADMIN"));
  r.get("/rates", c.list);
  r.get("/availability", c.listAvailability);
  r.post("/availability", c.availability);
  r.post("/rates", c.create);
  r.post("/rates/:rateId/publish", c.publish);
  r.post("/rates/:rateId/retire", c.retire);
  return r;
}

export const platformRoutePricingRouter = createPlatformRoutePricingRouter();

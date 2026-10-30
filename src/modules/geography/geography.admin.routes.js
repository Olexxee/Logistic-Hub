import { Router } from "express";
import { requireAuth,requireRole } from "../auth/auth.middleware.js";
import { prisma } from "../../db/prisma.js";
import { createGeographyAdminController } from "./geography.admin.controller.js";
export function createGeographyAdminRouter({prismaClient=prisma,authMiddleware=requireAuth,roleMiddleware=requireRole}={}) {
 const router=Router(), c=createGeographyAdminController({prismaClient}), admin=roleMiddleware("ADMIN");
 router.use(authMiddleware,admin);
 router.get("/countries",c.listCountries); router.post("/countries",c.createCountry); router.patch("/countries/:id",c.updateCountry); router.patch("/countries/:id/status",c.setCountryActive);
 router.get("/states",c.listStates); router.post("/states",c.createState); router.patch("/states/:id",c.updateState); router.patch("/states/:id/status",c.setStateActive);
 router.get("/lgas",c.listLgas); router.post("/lgas",c.createLga); router.patch("/lgas/:id",c.updateLga); router.delete("/lgas/:id",c.deleteLga);
 return router;
}
export const geographyAdminRouter=createGeographyAdminRouter();
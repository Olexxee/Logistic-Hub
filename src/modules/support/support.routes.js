import {Router} from "express";
import {z} from "zod";
import {prisma} from "../../db/prisma.js";
import {requireAuth,requireRole} from "../auth/auth.middleware.js";
import {validate} from "../../shared/http/validate.js";
import {createSupportService} from "./support.service.js";
import {createSupportController} from "./support.controller.js";
import {createTicketSchema,updateTicketSchema} from "./support.schemas.js";
export function createSupportRouter({prismaClient=prisma}={}){const r=Router();const c=createSupportController(createSupportService({prismaClient}));const id=z.object({ticketId:z.string().trim().min(1).max(128)});r.post("/tickets",requireAuth,validate(createTicketSchema),c.create);r.get("/tickets/mine",requireAuth,c.mine);r.get("/admin/tickets",requireAuth,requireRole("ADMIN","SUPPORT"),c.adminList);r.patch("/admin/tickets/:ticketId",requireAuth,requireRole("ADMIN","SUPPORT"),validate(id,"params"),validate(updateTicketSchema),c.update);return r;}
export const supportRouter=createSupportRouter();

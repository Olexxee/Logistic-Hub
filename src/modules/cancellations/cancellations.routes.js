import {Router} from "express";
import {z} from "zod";
import {prisma} from "../../db/prisma.js";
import {requireAuth} from "../auth/auth.middleware.js";
import {validate} from "../../shared/http/validate.js";
import {asyncWrapper} from "../../shared/http/async-wrapper.js";
import {createCancellationsService} from "./cancellations.service.js";
const listSchema=z.object({cursor:z.string().trim().min(1).max(128).optional(),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict();
const schema=z.object({bookingType:z.enum(["PARCEL","RIDE"]),bookingId:z.string().trim().min(1).max(128),reason:z.string().trim().min(5).max(500)}).strict();
export function createCancellationsRouter({prismaClient=prisma}={}){const r=Router();const s=createCancellationsService({prismaClient});r.get("/mine",requireAuth,validate(listSchema,"query"),asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await s.listMine({userId:req.user.id,...req.query})})));r.post("/",requireAuth,validate(schema),asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await s.cancel({...req.body,userId:req.user.id})})));return r;}
export const cancellationsRouter=createCancellationsRouter();

import { createPlatformRoutePricingService } from "./platform-route-pricing.service.js";
import { availabilitySchema,rateSchema,reasonSchema,listSchema } from "./platform-route-pricing.validators.js";
const invalid=(res,issues)=>res.status(400).json({success:false,error:{code:"VALIDATION_ERROR",message:"One or more fields are invalid.",details:issues.map(x=>({path:x.path.join("."),message:x.message}))}});
export function createPlatformRoutePricingController({prismaClient}){const s=createPlatformRoutePricingService({prismaClient});return {
 list:async(req,res,next)=>{const p=listSchema.safeParse(req.query);if(!p.success)return invalid(res,p.error.issues);try{return res.status(200).json({success:true,data:{items:await s.list(p.data)}})}catch(e){return next(e)}},
 availability:async(req,res,next)=>{const p=availabilitySchema.safeParse(req.body);if(!p.success)return invalid(res,p.error.issues);try{return res.status(200).json({success:true,data:{availability:await s.setAvailability(p.data,req.user.id)}})}catch(e){return next(e)}},
 create:async(req,res,next)=>{const p=rateSchema.safeParse(req.body);if(!p.success)return invalid(res,p.error.issues);try{return res.status(201).json({success:true,data:{rate:await s.create(p.data,req.user.id)}})}catch(e){return next(e)}},
 publish:async(req,res,next)=>{const p=reasonSchema.safeParse(req.body);if(!p.success)return invalid(res,p.error.issues);try{return res.status(200).json({success:true,data:{rate:await s.publish(req.params.rateId,req.user.id,p.data.reason)}})}catch(e){return next(e)}},
 retire:async(req,res,next)=>{const p=reasonSchema.safeParse(req.body);if(!p.success)return invalid(res,p.error.issues);try{return res.status(200).json({success:true,data:{rate:await s.retire(req.params.rateId,req.user.id,p.data.reason)}})}catch(e){return next(e)}}
}}

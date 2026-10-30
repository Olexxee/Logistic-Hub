import { createGeographyAdminService } from "./geography.admin.service.js";
import { activeSchema,countryCreateSchema,countryUpdateSchema,lgaCreateSchema,lgaFilterSchema,lgaUpdateSchema,stateCreateSchema,stateFilterSchema,stateUpdateSchema } from "./geography.admin.validators.js";
function invalid(res,issues){return res.status(400).json({success:false,error:{code:"VALIDATION_ERROR",message:"One or more fields are invalid.",details:issues.map(({path,message})=>({path:path.join("."),message}))}});}
function parse(res,schema,value){const p=schema.safeParse(value);if(!p.success){invalid(res,p.error.issues);return null;}return p.data;}
function missing(res,entity){return res.status(404).json({success:false,error:{code:"NOT_FOUND",message:`${entity} not found.`}});}
export function createGeographyAdminController({prismaClient}) {
 const s=createGeographyAdminService({prismaClient});
 return {
  listCountries:async(_q,res,next)=>{try{return res.json({success:true,data:{items:await s.listCountries()}})}catch(e){next(e)}},
  createCountry:async(q,res,next)=>{const v=parse(res,countryCreateSchema,q.body);if(!v)return;try{return res.status(201).json({success:true,data:{country:await s.createCountry(v)}})}catch(e){next(e)}},
  updateCountry:async(q,res,next)=>{const v=parse(res,countryUpdateSchema,q.body);if(!v)return;try{const x=await s.updateCountry(q.params.id,v);return x?res.json({success:true,data:{country:x}}):missing(res,"Country")}catch(e){next(e)}},
  setCountryActive:async(q,res,next)=>{const v=parse(res,activeSchema,q.body);if(!v)return;try{const x=await s.setCountryActive(q.params.id,v.isActive);return x?res.json({success:true,data:{country:x}}):missing(res,"Country")}catch(e){next(e)}},
  listStates:async(q,res,next)=>{const v=parse(res,stateFilterSchema,q.query);if(!v)return;try{return res.json({success:true,data:{items:await s.listStates(v.countryId)}})}catch(e){next(e)}},
  createState:async(q,res,next)=>{const v=parse(res,stateCreateSchema,q.body);if(!v)return;try{const x=await s.createState(v);return x?res.status(201).json({success:true,data:{state:x}}):missing(res,"Country")}catch(e){next(e)}},
  updateState:async(q,res,next)=>{const v=parse(res,stateUpdateSchema,q.body);if(!v)return;try{const x=await s.updateState(q.params.id,v);return x?res.json({success:true,data:{state:x}}):missing(res,"State")}catch(e){next(e)}},
  setStateActive:async(q,res,next)=>{const v=parse(res,activeSchema,q.body);if(!v)return;try{const x=await s.setStateActive(q.params.id,v.isActive);return x?res.json({success:true,data:{state:x}}):missing(res,"State")}catch(e){next(e)}},
  listLgas:async(q,res,next)=>{const v=parse(res,lgaFilterSchema,q.query);if(!v)return;try{return res.json({success:true,data:{items:await s.listLgas(v.stateId)}})}catch(e){next(e)}},
  createLga:async(q,res,next)=>{const v=parse(res,lgaCreateSchema,q.body);if(!v)return;try{const x=await s.createLga(v);return x?res.status(201).json({success:true,data:{lga:x}}):missing(res,"State")}catch(e){next(e)}},
  updateLga:async(q,res,next)=>{const v=parse(res,lgaUpdateSchema,q.body);if(!v)return;try{const x=await s.updateLga(q.params.id,v);return x?res.json({success:true,data:{lga:x}}):missing(res,"LGA")}catch(e){next(e)}},
  deleteLga:async(q,res,next)=>{try{const x=await s.deleteLga(q.params.id);return x?res.status(204).end():missing(res,"LGA")}catch(e){next(e)}}
 };
}
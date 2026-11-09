import { asyncWrapper } from "../../shared/http/async-wrapper.js";
export function createAssignmentsController(service){return {
 placeExecutionHold:asyncWrapper(async(req,res)=>{
  const result=await service.placeExecutionHold({assignmentId:req.params.assignmentId,actorUserId:req.user.id,reason:req.body.reason});
  if(result.notFound)return res.status(404).json({success:false,error:{code:"ASSIGNMENT_NOT_FOUND",message:"Assignment not found."}});
  if(result.blocker==="PARCEL_ASSIGNMENT_REQUIRED")return res.status(409).json({success:false,error:{code:result.blocker,message:"Safety holds in this phase are supported for parcel assignments only."}});
  if(result.blocker==="ASSIGNMENT_TERMINAL")return res.status(409).json({success:false,error:{code:result.blocker,message:"Completed, cancelled, or failed assignments cannot be placed on execution hold."}});
  return res.status(result.replay?200:201).json({success:true,data:result});
 }),
 releaseExecutionHold:asyncWrapper(async(req,res)=>{
  const result=await service.releaseExecutionHold({assignmentId:req.params.assignmentId,actorUserId:req.user.id,reason:req.body.reason});
  if(result.notFound)return res.status(404).json({success:false,error:{code:"ASSIGNMENT_NOT_FOUND",message:"Assignment not found."}});
  if(result.blocker==="ASSIGNMENT_NOT_HELD")return res.status(409).json({success:false,error:{code:result.blocker,message:"Assignment does not have an active execution hold."}});
  return res.status(200).json({success:true,data:result});
 }),
 listExecutionHolds:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.listExecutionHolds({page:req.validated.query.page,limit:req.validated.query.limit})})),
 listMine:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.listMine({userId:req.user.id,page:req.validated.query.page,limit:req.validated.query.limit})})),
 arrived:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.markArrived({assignmentId:req.params.assignmentId,userId:req.user.id})})),
 start:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.startTrip({assignmentId:req.params.assignmentId,userId:req.user.id})})),
 destination:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.markDestination({assignmentId:req.params.assignmentId,userId:req.user.id})})),
 issueCode:asyncWrapper(async(req,res)=>res.status(201).json({success:true,data:await service.issueCode({assignmentId:req.params.assignmentId,user:req.user,action:req.body.action})})),
 verifyCode:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.verifyCode({assignmentId:req.params.assignmentId,userId:req.user.id,...req.body})})),
 location:asyncWrapper(async(req,res)=>{const data=await service.location({assignmentId:req.params.assignmentId,user:req.user});res.status(200).json({success:true,data});}),
};}

import { asyncWrapper } from "../../shared/http/async-wrapper.js";
export function createAssignmentsController(service){return {
 arrived:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.markArrived({assignmentId:req.params.assignmentId,userId:req.user.id})})),
 destination:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.markDestination({assignmentId:req.params.assignmentId,userId:req.user.id})})),
 issueCode:asyncWrapper(async(req,res)=>res.status(201).json({success:true,data:await service.issueCode({assignmentId:req.params.assignmentId,user:req.user,action:req.body.action})})),
 verifyCode:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.verifyCode({assignmentId:req.params.assignmentId,userId:req.user.id,...req.body})})),
 location:asyncWrapper(async(req,res)=>{const data=await service.location({assignmentId:req.params.assignmentId,user:req.user});res.status(200).json({success:true,data});}),
};}

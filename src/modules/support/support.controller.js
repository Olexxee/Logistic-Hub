import {asyncWrapper} from "../../shared/http/async-wrapper.js";
export function createSupportController(service){return{
 create:asyncWrapper(async(req,res)=>res.status(201).json({success:true,data:await service.create({user:req.user,input:req.body})})),
 mine:asyncWrapper(async(req,res)=>res.status(200).json({success:true,...await service.listMine({userId:req.user.id,cursor:req.query.cursor,limit:Number(req.query.limit)||20})})),
 adminList:asyncWrapper(async(req,res)=>res.status(200).json({success:true,...await service.listAdmin({status:req.query.status,cursor:req.query.cursor,limit:Number(req.query.limit)||50})})),
 update:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.update({id:req.params.ticketId,user:req.user,input:req.body})}))
};}

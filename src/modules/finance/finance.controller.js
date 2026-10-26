import {asyncWrapper} from "../../shared/http/async-wrapper.js";
export function createFinanceController(service){return{
 requestRefund:asyncWrapper(async(req,res)=>res.status(201).json({success:true,data:await service.requestRefund({userId:req.user.id,input:req.body,idempotencyKey:req.get("Idempotency-Key")}))),
 reviewRefund:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.reviewRefund({id:req.params.refundId,user:req.user,...req.body})})),
 refunds:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.listRefunds({status:req.query.status})})),
 payouts:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.listPayouts({status:req.query.status})})),
 confirmPayout:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.confirmPayout({id:req.params.payoutId,providerReference:req.body.providerReference,user:req.user})})),
 reconciliation:asyncWrapper(async(req,res)=>res.status(200).json({success:true,data:await service.reconciliation()}))
};}

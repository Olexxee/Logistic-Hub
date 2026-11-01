import {prisma} from "../../db/prisma.js";
import {writeOperationalAuditEvent} from "../../shared/audit/operational-audit.js";
export function createFinanceRepository(prismaClient=prisma){return{
 async createRefundRequest({userId,paymentAttemptId,amountMinor,reason,idempotencyKey,publicReference}) {
  return prismaClient.$transaction(async tx => {
   const attempt=await tx.paymentAttempt.findUnique({where:{id:paymentAttemptId},include:{parcelBooking:true,rideBooking:true}});
   if(!attempt)return{notFound:true};
   const owner=attempt.parcelBooking?.senderId??attempt.rideBooking?.passengerId;
   if(owner!==userId)return{forbidden:true};
   if(attempt.status!=="SUCCEEDED")return{conflict:true};
   const amount=BigInt(amountMinor);
   const prior=await tx.refundRequest.findUnique({where:{idempotencyKey}});
   if(prior){
    if(prior.paymentAttemptId!==paymentAttemptId||prior.amountMinor!==amount||prior.requestedByUserId!==userId||prior.reason!==reason)return{conflict:true};
    return {refund:prior,replay:true};
   }
   if(amount<=0n||amount>attempt.amountMinor)return{conflict:true};
   const already=await tx.refundRequest.aggregate({where:{paymentAttemptId,status:{in:["PENDING_REVIEW","PROCESSING","PROCESSED"]}},_sum:{amountMinor:true}});
   if((already._sum.amountMinor??0n)+amount>attempt.amountMinor)return{conflict:true};
   const refund=await tx.refundRequest.create({data:{publicReference,paymentAttemptId,amountMinor:amount,currency:attempt.currency,reason,requestedByUserId:userId,idempotencyKey}});
   await writeOperationalAuditEvent(tx,{actorUserId:userId,entityType:"REFUND_REQUEST",entityId:refund.id,action:"REFUND_REQUESTED",after:{publicReference, paymentAttemptId, amountMinor:amount.toString(), currency:attempt.currency}});
   return {refund,replay:false};
  },{isolationLevel:"Serializable"});
 },
 listRefunds({status}){return prismaClient.refundRequest.findMany({where:status?{status}:{},orderBy:{createdAt:"desc"},take:100});},
 findRefund(id){return prismaClient.refundRequest.findUnique({where:{id},include:{paymentAttempt:true}});},
 reviewRefund({id,reviewerId,decision,note}) {
  return prismaClient.$transaction(async tx => {
   const current=await tx.refundRequest.findUnique({where:{id}});
   if(!current)return null;
   if(!["PENDING_REVIEW","FAILED"].includes(current.status))return null;
   const changed=await tx.refundRequest.updateMany({where:{id,status:current.status},data:{
    status:decision==="REJECT"?"REJECTED":"PROCESSING",
    reviewedByUserId:reviewerId,reviewedAt:new Date(),providerResponse:{reviewNote:note??null},
   }});
   if(changed.count!==1)return null;
   const updated=await tx.refundRequest.findUnique({where:{id}});
   await writeOperationalAuditEvent(tx,{actorUserId:reviewerId,entityType:"REFUND_REQUEST",entityId:id,action:decision==="REJECT"?"REFUND_REQUEST_REJECTED":"REFUND_REQUEST_APPROVED_FOR_PROCESSING",reason:note,before:{status:current.status},after:{status:updated.status,reviewedByUserId:reviewerId}});
   if(decision==="REJECT"&&current.idempotencyKey?.startsWith("cancel-refund-")){
    const bookingType=current.parcelBookingId?"PARCEL":(current.rideBookingId?"RIDE":null);
    if(bookingType){
     const where=bookingType==="PARCEL"?{id:current.parcelBookingId}:{id:current.rideBookingId};
     const model=bookingType==="PARCEL"?tx.parcelBooking:tx.rideBooking;
     const booking=await model.findUnique({where});
     if(booking?.status==="CANCELLATION_PENDING"){
      const prior=await tx.bookingEvent.findFirst({where:{...(bookingType==="PARCEL"?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),eventType:"CANCELLATION_REVIEW_REQUESTED"},orderBy:[{createdAt:"desc"},{id:"desc"}]});
      if(prior?.fromStatus){
       await model.update({where,data:{status:prior.fromStatus,cancellationReason:null}});
       await tx.bookingEvent.create({data:{...(bookingType==="PARCEL"?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),actorUserId:reviewerId,eventType:"CANCELLATION_REJECTED",fromStatus:"CANCELLATION_PENDING",toStatus:prior.fromStatus,metadata:{refundRequestId:current.id,refundReference:current.publicReference,reason:note??null}}});
      }
     }
    }
   }
   return updated;
  },{isolationLevel:"Serializable"});
 },
 recordRefundProviderResult({id,providerReference,providerResponse,actorUserId}){return prismaClient.$transaction(async tx=>{const current=await tx.refundRequest.findUnique({where:{id}});const updated=await tx.refundRequest.update({where:{id},data:{status:"PROCESSING",providerReference,providerResponse}});await writeOperationalAuditEvent(tx,{actorUserId,entityType:"REFUND_REQUEST",entityId:id,action:"REFUND_PROVIDER_REQUEST_RECORDED",before:{status:current?.status,providerReference:current?.providerReference},after:{status:updated.status,providerReference:updated.providerReference}});return updated;});},
 markRefundSubmissionUnknown({id,actorUserId}) {
  return prismaClient.$transaction(async tx=>{
   const current=await tx.refundRequest.findUnique({where:{id}});
   if(!current)return null;
   const providerResponse={submissionOutcome:"UNKNOWN",reconciliationRequired:true};
   const updated=await tx.refundRequest.update({where:{id},data:{providerResponse}});
   await writeOperationalAuditEvent(tx,{actorUserId,entityType:"REFUND_REQUEST",entityId:id,action:"REFUND_PROVIDER_OUTCOME_UNKNOWN",before:{status:current.status},after:{status:updated.status,...providerResponse}});
   return updated;
  });
 },
 markRefundFailed({id,providerResponse,actorUserId}){return prismaClient.$transaction(async tx=>{const current=await tx.refundRequest.findUnique({where:{id}});const updated=await tx.refundRequest.update({where:{id},data:{status:"FAILED",providerResponse}});if(actorUserId)await writeOperationalAuditEvent(tx,{actorUserId,entityType:"REFUND_REQUEST",entityId:id,action:"REFUND_PROVIDER_REQUEST_FAILED",before:{status:current?.status},after:{status:updated.status}});return updated;});},
 updateRefundFromWebhook({providerReference,status,providerResponse}){return prismaClient.$transaction(async tx=>{const allowedPreviousStatuses=status==="PROCESSED"?["PROCESSING","FAILED"]:["PROCESSING"];const current=await tx.refundRequest.findMany({where:{providerReference,status:{in:allowedPreviousStatuses}},select:{id:true,status:true,providerReference:true}});let count=0;for(const refund of current){const updated=await tx.refundRequest.updateMany({where:{id:refund.id,status:{in:allowedPreviousStatuses}},data:{status,providerResponse,processedAt:new Date()}});if(updated.count!==1)continue;await writeOperationalAuditEvent(tx,{actorType:"SYSTEM",systemSource:"PAYSTACK_REFUND_WEBHOOK",entityType:"REFUND_REQUEST",entityId:refund.id,action:"REFUND_PROVIDER_WEBHOOK_STATUS_UPDATED",before:{status:refund.status,providerReference:refund.providerReference},after:{status,providerReference:refund.providerReference},metadata:{providerEvent:providerResponse?.event??null}});count+=1;}return{count};});},
 listPayouts({status}){return prismaClient.driverPayout.findMany({where:status?{status}:{},include:{driverProfile:{include:{user:{select:{id:true,fullName:true,email:true}}}},parcelBooking:{select:{publicReference:true}},rideBooking:{select:{publicReference:true}}},orderBy:{createdAt:"asc"},take:100});},
 confirmPayout({id,providerReference,actorUserId}){return prismaClient.$transaction(async tx=>{const p=await tx.driverPayout.findUnique({where:{id}});if(!p)return null;if(p.status==="PAID")return p;const updated=await tx.driverPayout.update({where:{id},data:{status:"PAID",providerReference,processedAt:new Date()}});await writeOperationalAuditEvent(tx,{actorUserId,entityType:"DRIVER_PAYOUT",entityId:id,action:"DRIVER_PAYOUT_SETTLEMENT_CONFIRMED",before:{status:p.status,providerReference:p.providerReference},after:{status:updated.status,providerReference:updated.providerReference}});return updated;});},
 async reconciliation(){const [entries,unposted,pendingPayouts,pendingRefunds]=await Promise.all([prismaClient.ledgerEntry.findMany({select:{journalReference:true,side:true,amountMinor:true,currency:true}}),prismaClient.paymentAttempt.findMany({where:{status:"SUCCEEDED",ledgerEntries:{none:{}}},select:{id:true,providerReference:true,amountMinor:true,currency:true}}),prismaClient.driverPayout.findMany({where:{status:{in:["PENDING","ELIGIBLE","PROCESSING","FAILED"]}},select:{id:true,driverProfileId:true,amountMinor:true,currency:true,status:true,createdAt:true}}),prismaClient.refundRequest.findMany({where:{status:{in:["PENDING_REVIEW","PROCESSING","FAILED"]}},select:{id:true,amountMinor:true,currency:true,status:true,createdAt:true}})]);const journals=new Map();for(const e of entries){const key=e.journalReference+"|"+e.currency;const j=journals.get(key)??{journalReference:e.journalReference,currency:e.currency,debits:0n,credits:0n};if(e.side==="DEBIT")j.debits+=e.amountMinor;else j.credits+=e.amountMinor;journals.set(key,j);}const unbalanced=[...journals.values()].filter(j=>j.debits!==j.credits).map(j=>({...j,debits:j.debits.toString(),credits:j.credits.toString(),difference:(j.debits-j.credits).toString()}));return{checkedAt:new Date(),journalCount:journals.size,unbalancedJournals:unbalanced,successfulPaymentsWithoutLedger:unposted.map(x=>({...x,amountMinor:x.amountMinor.toString()})),pendingDriverSettlements:pendingPayouts.map(x=>({...x,amountMinor:x.amountMinor.toString()})),refundsRequiringAttention:pendingRefunds.map(x=>({...x,amountMinor:x.amountMinor.toString()}))};}
};}

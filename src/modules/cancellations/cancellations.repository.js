import { prisma } from "../../db/prisma.js";
import { createHash } from "node:crypto";
export function createCancellationsRepository(prismaClient=prisma){return{
 listMine({userId,cursor,limit=20}) {
  return prismaClient.bookingEvent.findMany({
   where:{actorUserId:userId,eventType:{in:["BOOKING_CANCELLED","CANCELLATION_REVIEW_REQUESTED"]}},
   orderBy:[{createdAt:"desc"},{id:"desc"}],
   take:limit+1,
   ...(cursor?{cursor:{id:cursor},skip:1}:{}),
   select:{
    id:true,eventType:true,fromStatus:true,toStatus:true,metadata:true,createdAt:true,
    parcelBooking:{select:{id:true,publicReference:true,status:true,paymentStatus:true,cancellationReason:true,cancelledAt:true,refunds:{where:{requestedByUserId:userId},select:{id:true,publicReference:true,amountMinor:true,currency:true,reason:true,status:true,reviewedAt:true,processedAt:true,createdAt:true},orderBy:{createdAt:"desc"}}}},
    rideBooking:{select:{id:true,publicReference:true,status:true,paymentStatus:true,cancellationReason:true,cancelledAt:true,refunds:{where:{requestedByUserId:userId},select:{id:true,publicReference:true,amountMinor:true,currency:true,reason:true,status:true,reviewedAt:true,processedAt:true,createdAt:true},orderBy:{createdAt:"desc"}}}}
   }
  });
 },
 cancel({bookingType,bookingId,userId,reason,now}){return prismaClient.$transaction(async tx=>{
  const isParcel=bookingType==="PARCEL";
  const booking=isParcel?await tx.parcelBooking.findFirst({where:{id:bookingId,senderId:userId}}):await tx.rideBooking.findFirst({where:{id:bookingId,passengerId:userId}});
  if(!booking)return null;
  if(["COMPLETED","CANCELLED","FAILED","CANCELLATION_PENDING"].includes(booking.status))return{conflict:true,status:booking.status};
  const paid=booking.paymentStatus==="SUCCEEDED";
  const nextStatus=paid?"CANCELLATION_PENDING":"CANCELLED";
  if(isParcel)await tx.parcelBooking.update({where:{id:booking.id},data:{status:nextStatus,...(!paid?{cancelledAt:now}:{}),cancellationReason:reason}});
  else await tx.rideBooking.update({where:{id:booking.id},data:{status:nextStatus,...(!paid?{cancelledAt:now}:{}),cancellationReason:reason}});
  if(!paid){
   await tx.driverOffer.updateMany({where:isParcel?{parcelBookingId:booking.id,status:{in:["OFFERED","ACCEPTED"]}}:{rideBookingId:booking.id,status:{in:["OFFERED","ACCEPTED"]}},data:{status:"WITHDRAWN",respondedAt:now}});
   const assignments=await tx.driverAssignment.findMany({where:isParcel?{parcelBookingId:booking.id,status:{notIn:["COMPLETED","CANCELLED","FAILED"]}}:{rideBookingId:booking.id,status:{notIn:["COMPLETED","CANCELLED","FAILED"]}},select:{id:true,driverProfileId:true}});
   for(const a of assignments){await tx.driverAssignment.update({where:{id:a.id},data:{status:"CANCELLED",cancelledAt:now,failureReason:"Customer cancelled before payment"}});await tx.driverProfile.update({where:{id:a.driverProfileId},data:{isAvailable:true}});}
  }
  let supportTicketReference=null;
  let refundRequestReference=null;
  if(paid){
   supportTicketReference="SUP-CANCEL-"+booking.publicReference;
   const paymentAttempt=await tx.paymentAttempt.findFirst({
    where:{...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),status:"SUCCEEDED"},
    orderBy:{verifiedAt:"desc"},
   });
   if(paymentAttempt?.providerReference){
    const reserved=await tx.refundRequest.aggregate({
     where:{paymentAttemptId:paymentAttempt.id,status:{in:["PENDING_REVIEW","PROCESSING","PROCESSED"]}},
     _sum:{amountMinor:true},
    });
    const remaining=paymentAttempt.amountMinor-(reserved._sum.amountMinor??0n);
    if(remaining>0n){
     const suffix=createHash("sha256").update(bookingType+":"+booking.id).digest("hex").slice(0,16).toUpperCase();
     refundRequestReference="RF-CANCEL-"+suffix;
     const idempotencyKey="cancel-refund-"+suffix;
     const refund=await tx.refundRequest.create({data:{
      publicReference:refundRequestReference,paymentAttemptId:paymentAttempt.id,
      ...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),
      amountMinor:remaining,currency:paymentAttempt.currency,reason,
      status:"PENDING_REVIEW",requestedByUserId:userId,idempotencyKey,
     }});
     await tx.operationalAuditEvent.create({data:{
      actorUserId:userId,entityType:"REFUND_REQUEST",entityId:refund.id,
      action:"CANCELLATION_REFUND_REQUESTED",
      after:{refundReference:refundRequestReference,bookingId:booking.id,bookingType,amountMinor:remaining.toString(),currency:refund.currency},
     }});
    }
   }
   await tx.supportTicket.create({data:{publicReference:supportTicketReference,customerId:userId,bookingType,bookingId:booking.id,...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),category:"REFUND",subject:"Cancellation and refund review: "+booking.publicReference,description:"Customer requested cancellation after payment. Reason: "+reason+(refundRequestReference?"\nRefund request created for staff review: "+refundRequestReference+".":"\nNo eligible captured payment attempt was found; staff investigation is required.")+"\nNo provider refund has been issued.",status:"OPEN",priority:"HIGH"}});
  }
  await tx.bookingEvent.create({data:{...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),actorUserId:userId,eventType:paid?"CANCELLATION_REVIEW_REQUESTED":"BOOKING_CANCELLED",fromStatus:booking.status,toStatus:nextStatus,metadata:{reason,refundReviewRequired:paid,supportTicketReference,refundRequestReference}}});
  return{bookingId:booking.id,bookingType,status:nextStatus,refundReviewRequired:paid,supportTicketReference,refundRequestReference,policy:paid?"Payment captured: cancellation and refund are awaiting staff review; creating a refund request does not issue a provider refund.":"Unpaid booking cancelled; offers withdrawn and reserved driver released."};
 });}
};}

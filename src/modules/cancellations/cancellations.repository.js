import {prisma} from "../../db/prisma.js";
export function createCancellationsRepository(prismaClient=prisma){return{
 cancel({bookingType,bookingId,userId,reason,now}){return prismaClient.$transaction(async tx=>{
  const isParcel=bookingType==="PARCEL";
  const booking=isParcel?await tx.parcelBooking.findFirst({where:{id:bookingId,senderId:userId}}):await tx.rideBooking.findFirst({where:{id:bookingId,passengerId:userId}});
  if(!booking)return null;
  if(["COMPLETED","CANCELLED","FAILED"].includes(booking.status))return{conflict:true,status:booking.status};
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
  if(paid){supportTicketReference="SUP-CANCEL-"+booking.publicReference;await tx.supportTicket.create({data:{publicReference:supportTicketReference,customerId:userId,bookingType,bookingId:booking.id,category:"REFUND",subject:"Cancellation and refund review: "+booking.publicReference,description:"Customer requested cancellation after payment. Reason: "+reason+"\nSupport must review eligibility and explicitly approve any refund; no automatic refund was issued.",status:"OPEN",priority:"HIGH"}});}
  await tx.bookingEvent.create({data:{...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),actorUserId:userId,eventType:paid?"CANCELLATION_REVIEW_REQUESTED":"BOOKING_CANCELLED",fromStatus:booking.status,toStatus:nextStatus,metadata:{reason,refundReviewRequired:paid,supportTicketReference}}});
  return{bookingId:booking.id,bookingType,status:nextStatus,refundReviewRequired:paid,supportTicketReference,policy:paid?"Payment captured: cancellation and refund require support/admin review; no automatic refund was issued.":"Unpaid booking cancelled; offers withdrawn and reserved driver released."};
 });}
};}

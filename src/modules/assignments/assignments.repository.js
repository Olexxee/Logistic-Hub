import { prisma } from "../../db/prisma.js";
export function createAssignmentsRepository(prismaClient = prisma) {
 return {
  findAssignment(id) { return prismaClient.driverAssignment.findUnique({where:{id},include:{driverProfile:{select:{id:true,userId:true}},parcelBooking:true,rideBooking:true}}); },
  findOwnerLocation({assignment,now}) {
   const booking=assignment.parcelBooking||assignment.rideBooking;
   return prismaClient.driverLocation.findFirst({where:{driverProfileId:assignment.driverProfileId,recordedAt:{gte:new Date(now.getTime()-2*60*1000)}},orderBy:{recordedAt:"desc"},select:{latitude:true,longitude:true,accuracyMeters:true,recordedAt:true}});
  },
  issueCode({assignment,action,tokenHash,expiresAt,now}) {
   return prismaClient.$transaction(async tx=>{
    const fresh=await tx.driverAssignment.findUnique({where:{id:assignment.id},include:{parcelBooking:true,rideBooking:true}});
    if(!fresh||fresh.status==="COMPLETED"||fresh.status==="CANCELLED")return null;
    const booking=fresh.parcelBooking||fresh.rideBooking;
    const ownerId=fresh.parcelBooking?booking.senderId:booking.passengerId;
    if(action==="PICKUP"&&fresh.status!=="ARRIVED_AT_PICKUP")return {conflict:true};
    if(action==="DELIVERY"&&fresh.status!=="ARRIVED_AT_DESTINATION")return {conflict:true};
    await tx.verificationToken.updateMany({where:{...(fresh.parcelBookingId?{parcelBookingId:fresh.parcelBookingId}:{rideBookingId:fresh.rideBookingId}),...(fresh.deliveryLegId?{deliveryLegId:fresh.deliveryLegId}:{}),action:action==="PICKUP"?(fresh.parcelBookingId?"PARCEL_PICKUP":"RIDE_PICKUP"):(fresh.parcelBookingId?"PARCEL_DELIVERY":"RIDE_COMPLETION"),status:"ACTIVE"},data:{status:"REVOKED"}});
    await tx.verificationToken.create({data:{...(fresh.parcelBookingId?{parcelBookingId:fresh.parcelBookingId}:{rideBookingId:fresh.rideBookingId}),...(fresh.deliveryLegId?{deliveryLegId:fresh.deliveryLegId}:{}),action:action==="PICKUP"?(fresh.parcelBookingId?"PARCEL_PICKUP":"RIDE_PICKUP"):(fresh.parcelBookingId?"PARCEL_DELIVERY":"RIDE_COMPLETION"),tokenHash,status:"ACTIVE",expiresAt}});
    return {ownerId,bookingId:booking.id,publicReference:booking.publicReference};
   });
  },
  transition({assignmentId,driverUserId,nextStatus,now}) {
   return prismaClient.$transaction(async tx=>{
    const a=await tx.driverAssignment.findUnique({where:{id:assignmentId},include:{driverProfile:true,parcelBooking:true,rideBooking:true}});
    if(!a)return null;
    if(a.driverProfile.userId!==driverUserId) return {forbidden:true};
    const allowed={ACCEPTED:["ARRIVED_AT_PICKUP"],ARRIVED_AT_PICKUP:[],PICKUP_CONFIRMED:["IN_PROGRESS"],IN_PROGRESS:["ARRIVED_AT_DESTINATION"],ARRIVED_AT_DESTINATION:[]};
    if(!(allowed[a.status]||[]).includes(nextStatus))return {conflict:true,status:a.status};
    const updated=await tx.driverAssignment.update({where:{id:a.id},data:{status:nextStatus,...(nextStatus==="ARRIVED_AT_PICKUP"?{pickupAt:now}:{}),...(nextStatus==="IN_PROGRESS"?{startedAt:now}:{}),...(nextStatus==="COMPLETED"?{completedAt:now}:{})}});
    if(a.deliveryLegId) await tx.deliveryLeg.update({where:{id:a.deliveryLegId},data:{status:nextStatus==="ARRIVED_AT_PICKUP"?"PICKUP_VERIFICATION_PENDING":nextStatus==="IN_PROGRESS"?"IN_TRANSIT":nextStatus==="ARRIVED_AT_DESTINATION"?"DELIVERY_VERIFICATION_PENDING":a.deliveryLeg?.status??"ASSIGNED",...(nextStatus==="IN_PROGRESS"?{startedAt:now}:{})}});
    if(a.parcelBookingId) await tx.parcelBooking.update({where:{id:a.parcelBookingId},data:{status:nextStatus==="ARRIVED_AT_PICKUP"?"PICKUP_VERIFICATION_PENDING":nextStatus==="IN_PROGRESS"?"IN_TRANSIT":nextStatus==="ARRIVED_AT_DESTINATION"?"DELIVERY_VERIFICATION_PENDING":nextStatus==="COMPLETED"?"COMPLETED":a.parcelBooking.status,...(nextStatus==="COMPLETED"?{completedAt:now}:{})}});
    if(a.rideBookingId) await tx.rideBooking.update({where:{id:a.rideBookingId},data:{status:nextStatus==="ARRIVED_AT_PICKUP"?"DRIVER_ARRIVED":nextStatus==="IN_PROGRESS"?"TRIP_IN_PROGRESS":nextStatus==="ARRIVED_AT_DESTINATION"?"TRIP_COMPLETION_PENDING":nextStatus==="COMPLETED"?"COMPLETED":a.rideBooking.status,...(nextStatus==="IN_PROGRESS"?{tripStartedAt:now}:{}),...(nextStatus==="COMPLETED"?{completedAt:now}:{})}});
    await tx.bookingEvent.create({data:{...(a.parcelBookingId?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),actorUserId:driverUserId,eventType:"ASSIGNMENT_STATUS_CHANGED",fromStatus:a.status,toStatus:nextStatus,metadata:{assignmentId:a.id}}});
    if(nextStatus==="COMPLETED") await tx.driverProfile.update({where:{id:a.driverProfileId},data:{isAvailable:true,completedJobs:{increment:1}}});
    return {id:updated.id,status:updated.status,updatedAt:updated.updatedAt};
   });
  },
  verifyCode({assignmentId,driverUserId,action,tokenHash,now}) {
   return prismaClient.$transaction(async tx=>{
    const a=await tx.driverAssignment.findUnique({where:{id:assignmentId},include:{driverProfile:true,parcelBooking:true,rideBooking:true}});
    if(!a)return null;
    if(a.driverProfile.userId!==driverUserId)return {forbidden:true};
    const isParcel=Boolean(a.parcelBookingId);const booking=a.parcelBooking||a.rideBooking;
    const tokenAction=action==="PICKUP"?(isParcel?"PARCEL_PICKUP":"RIDE_PICKUP"):(isParcel?"PARCEL_DELIVERY":"RIDE_COMPLETION");
    const token=await tx.verificationToken.findFirst({where:{...(isParcel?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),...(a.deliveryLegId?{deliveryLegId:a.deliveryLegId}:{}),action:tokenAction,tokenHash,status:"ACTIVE",expiresAt:{gt:now}}});
    if(!token)return {invalid:true};
    const expected=action==="PICKUP"?"ARRIVED_AT_PICKUP":"ARRIVED_AT_DESTINATION";
    if(a.status!==expected)return {conflict:true,status:a.status};
    const consumed=await tx.verificationToken.updateMany({where:{id:token.id,status:"ACTIVE",expiresAt:{gt:now}},data:{status:"CONSUMED",consumedAt:now,consumedByUserId:driverUserId}});
    if(consumed.count!==1)return {invalid:true};
    const nextStatus=action==="PICKUP"?"PICKUP_CONFIRMED":"COMPLETED";
    await tx.driverAssignment.update({where:{id:a.id},data:{status:nextStatus,...(action==="PICKUP"?{pickupAt:now}:{completedAt:now})}});
    if(a.deliveryLegId) await tx.deliveryLeg.update({where:{id:a.deliveryLegId},data:{status:action==="PICKUP"?"IN_TRANSIT":"COMPLETED",...(action==="PICKUP"?{pickedUpAt:now}:{completedAt:now})}});
    if(isParcel) await tx.parcelBooking.update({where:{id:booking.id},data:{status:action==="PICKUP"?"PICKED_UP":"COMPLETED",...(action==="PICKUP"?{pickedUpAt:now}:{completedAt:now})}});
    else await tx.rideBooking.update({where:{id:booking.id},data:{status:action==="PICKUP"?"TRIP_IN_PROGRESS":"COMPLETED",...(action==="PICKUP"?{tripStartedAt:now}:{completedAt:now})}});
    await tx.bookingEvent.create({data:{...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),actorUserId:driverUserId,eventType:action==="PICKUP"?"PICKUP_VERIFIED":"COMPLETION_VERIFIED",fromStatus:a.status,toStatus:nextStatus,metadata:{assignmentId:a.id}}});
    if(action==="DELIVERY"){await tx.driverProfile.update({where:{id:a.driverProfileId},data:{isAvailable:true,completedJobs:{increment:1}}});await tx.driverPayout.upsert({where:{idempotencyKey:"completion-"+a.id},create:{driverProfileId:a.driverProfileId,...(a.parcelBookingId?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),amountMinor:a.agreedFareMinor,currency:a.currency,status:"PENDING",provider:"PAYSTACK",idempotencyKey:"completion-"+a.id},update:{}});}
    return {id:a.id,status:nextStatus,bookingStatus:action==="PICKUP"?(isParcel?"PICKED_UP":"TRIP_IN_PROGRESS"):"COMPLETED",verifiedAt:now};
   });
  },
 };
}

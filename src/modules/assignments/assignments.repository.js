import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";

const ASSIGNMENT_TRANSITIONS = Object.freeze({
 ACCEPTED: ["ARRIVED_AT_PICKUP"],
 ARRIVED_AT_PICKUP: [],
 PICKUP_CONFIRMED: ["IN_PROGRESS"],
 IN_PROGRESS: ["ARRIVED_AT_DESTINATION"],
 ARRIVED_AT_DESTINATION: [],
});

export function isAllowedAssignmentTransition(currentStatus, nextStatus) {
 return (ASSIGNMENT_TRANSITIONS[currentStatus] ?? []).includes(nextStatus);
}

export const MAX_VERIFICATION_CODE_ATTEMPTS = 5;
export function createAssignmentsRepository(prismaClient = prisma) {
 return {
  async listDriverAssignments({userId,skip,take}){
   const where={
    driverProfile:{is:{userId}},
    parcelBookingId:{not:null},
    parcelBooking:{is:{paymentStatus:"SUCCEEDED"}},
   };
   const [items,total]=await Promise.all([
    prismaClient.driverAssignment.findMany({
     where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip,take,
     include:{
      parcelBooking:true,
      deliveryLeg:{
       include:{
        originServiceZone:{select:{id:true,name:true}},
        destinationServiceZone:{select:{id:true,name:true}},
        originHubPoint:{select:{id:true,name:true,address:true}},
        destinationHubPoint:{select:{id:true,name:true,address:true}},
       },
      },
     },
    }),
    prismaClient.driverAssignment.count({where}),
   ]);
   return {items,total};
  },
  findAssignment(id) { return prismaClient.driverAssignment.findUnique({where:{id},include:{driverProfile:{select:{id:true,userId:true,verificationStatus:true,kycTier:true,suspendedAt:true}},parcelBooking:true,rideBooking:true}}); },
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
    const a=await tx.driverAssignment.findUnique({where:{id:assignmentId},include:{driverProfile:true,parcelBooking:true,rideBooking:true,deliveryLeg:true}});
    if(!a)return null;
    if(a.driverProfile.userId!==driverUserId) return {forbidden:true};
    if(a.driverProfile.verificationStatus!=="VERIFIED" || a.driverProfile.suspendedAt || !(a.driverProfile.kycTier==="FULL" || (env.DRIVER_KYC_MODE==="TEST" && a.driverProfile.kycTier==="TEST_LIMITED")) || (a.rideBookingId && a.driverProfile.kycTier!=="FULL")) return {forbidden:true};
    if(!isAllowedAssignmentTransition(a.status,nextStatus))return {conflict:true,status:a.status};
    const transition = await tx.driverAssignment.updateMany({
     where: { id: a.id, status: a.status },
     data: {
      status: nextStatus,
      ...(nextStatus==="ARRIVED_AT_PICKUP"?{pickupAt:now}:{}),
      ...(nextStatus==="IN_PROGRESS"?{startedAt:now}:{}),
      ...(nextStatus==="COMPLETED"?{completedAt:now}:{}),
     },
    });
    if (transition.count !== 1) return { conflict: true, status: a.status };
    const updated = { id: a.id, status: nextStatus, updatedAt: now };
    if(a.deliveryLegId) await tx.deliveryLeg.update({where:{id:a.deliveryLegId},data:{status:nextStatus==="ARRIVED_AT_PICKUP"?"PICKUP_VERIFICATION_PENDING":nextStatus==="IN_PROGRESS"?"IN_TRANSIT":nextStatus==="ARRIVED_AT_DESTINATION"?"DELIVERY_VERIFICATION_PENDING":a.deliveryLeg?.status??"ASSIGNED",...(nextStatus==="IN_PROGRESS"?{startedAt:now}:{})}});
    if(a.parcelBookingId) await tx.parcelBooking.update({where:{id:a.parcelBookingId},data:{status:nextStatus==="ARRIVED_AT_PICKUP"?"PICKUP_VERIFICATION_PENDING":nextStatus==="IN_PROGRESS"?"IN_TRANSIT":nextStatus==="ARRIVED_AT_DESTINATION"?"DELIVERY_VERIFICATION_PENDING":nextStatus==="COMPLETED"?"COMPLETED":a.parcelBooking.status,...(nextStatus==="COMPLETED"?{completedAt:now}:{})}});
    if(a.rideBookingId) await tx.rideBooking.update({where:{id:a.rideBookingId},data:{status:nextStatus==="ARRIVED_AT_PICKUP"?"DRIVER_ARRIVED":nextStatus==="IN_PROGRESS"?"TRIP_IN_PROGRESS":nextStatus==="ARRIVED_AT_DESTINATION"?"TRIP_COMPLETION_PENDING":nextStatus==="COMPLETED"?"COMPLETED":a.rideBooking.status,...(nextStatus==="IN_PROGRESS"?{tripStartedAt:now}:{}),...(nextStatus==="COMPLETED"?{completedAt:now}:{})}});
    await tx.bookingEvent.create({data:{...(a.parcelBookingId?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),actorUserId:driverUserId,eventType:"ASSIGNMENT_STATUS_CHANGED",fromStatus:a.status,toStatus:nextStatus,metadata:{assignmentId:a.id}}});
    if(nextStatus==="COMPLETED") await tx.driverProfile.update({where:{id:a.driverProfileId},data:{completedJobs:{increment:1}}});
    return {id:updated.id,status:updated.status,updatedAt:updated.updatedAt};
   });
  },
  verifyCode({assignmentId,driverUserId,action,tokenHash,now}) {
   return prismaClient.$transaction(async tx=>{
    const a=await tx.driverAssignment.findUnique({where:{id:assignmentId},include:{driverProfile:true,parcelBooking:true,rideBooking:true,deliveryLeg:true}});
    if(!a)return null;
    if(a.driverProfile.userId!==driverUserId)return {forbidden:true};
    if(a.driverProfile.verificationStatus!=="VERIFIED" || a.driverProfile.suspendedAt || !(a.driverProfile.kycTier==="FULL" || (env.DRIVER_KYC_MODE==="TEST" && a.driverProfile.kycTier==="TEST_LIMITED")) || (a.rideBookingId && a.driverProfile.kycTier!=="FULL")) return {forbidden:true};
    const isParcel=Boolean(a.parcelBookingId);const booking=a.parcelBooking||a.rideBooking;
    const tokenAction=action==="PICKUP"?(isParcel?"PARCEL_PICKUP":"RIDE_PICKUP"):(isParcel?"PARCEL_DELIVERY":"RIDE_COMPLETION");
    const token=await tx.verificationToken.findFirst({where:{...(isParcel?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),...(a.deliveryLegId?{deliveryLegId:a.deliveryLegId}:{}),action:tokenAction,status:"ACTIVE",expiresAt:{gt:now}}});
    if(!token)return {invalid:true};
    const expected=action==="PICKUP"?"ARRIVED_AT_PICKUP":"ARRIVED_AT_DESTINATION";
    if(a.status!==expected)return {conflict:true,status:a.status};
    if(token.failedAttempts>=MAX_VERIFICATION_CODE_ATTEMPTS){
     await tx.verificationToken.updateMany({where:{id:token.id,status:"ACTIVE"},data:{status:"REVOKED"}});
     return {invalid:true};
    }
    if(token.tokenHash!==tokenHash){
     const attempts=await tx.verificationToken.updateMany({where:{id:token.id,status:"ACTIVE",expiresAt:{gt:now},failedAttempts:token.failedAttempts},data:{failedAttempts:{increment:1},...(token.failedAttempts+1>=MAX_VERIFICATION_CODE_ATTEMPTS?{status:"REVOKED"}:{})}});
     return {invalid:true,locked:attempts.count===1&&token.failedAttempts+1>=MAX_VERIFICATION_CODE_ATTEMPTS};
    }
    const consumed=await tx.verificationToken.updateMany({where:{id:token.id,status:"ACTIVE",expiresAt:{gt:now},failedAttempts:{lt:MAX_VERIFICATION_CODE_ATTEMPTS}},data:{status:"CONSUMED",consumedAt:now,consumedByUserId:driverUserId}});
    if(consumed.count!==1)return {invalid:true};
    const nextStatus=action==="PICKUP"?"PICKUP_CONFIRMED":"COMPLETED";
    await tx.driverAssignment.update({where:{id:a.id},data:{status:nextStatus,...(action==="PICKUP"?{pickupAt:now}:{completedAt:now})}});
    let nextDeliveryLegId = null;
    let finalDeliveryLeg = true;
    if(a.deliveryLegId) {
     await tx.deliveryLeg.update({where:{id:a.deliveryLegId},data:{status:action==="PICKUP"?"IN_TRANSIT":"COMPLETED",...(action==="PICKUP"?{pickedUpAt:now}:{completedAt:now})}});
     if(action==="DELIVERY") {
      const nextLeg = await tx.deliveryLeg.findFirst({
       where:{parcelBookingId:booking.id,sequence:{gt:a.deliveryLeg.sequence}},
       orderBy:{sequence:"asc"},
       select:{id:true,status:true},
      });
      if(nextLeg) {
       const activated = await tx.deliveryLeg.updateMany({
        where:{id:nextLeg.id,status:"PLANNED"},
        data:{status:"READY_FOR_ASSIGNMENT"},
       });
       if(activated.count!==1) {
        throw Object.assign(new Error("The next delivery leg is not ready to be activated."),{statusCode:409,code:"DELIVERY_LEG_SEQUENCE_CONFLICT"});
       }
       nextDeliveryLegId = nextLeg.id;
       finalDeliveryLeg = false;
      }
     }
    }
    if(isParcel) await tx.parcelBooking.update({where:{id:booking.id},data:{
     status:action==="PICKUP"?"PICKED_UP":finalDeliveryLeg?"COMPLETED":"IN_TRANSIT",
     ...(action==="PICKUP"?{pickedUpAt:now}:finalDeliveryLeg?{completedAt:now}:{}),
    }});
    else await tx.rideBooking.update({where:{id:booking.id},data:{status:action==="PICKUP"?"TRIP_IN_PROGRESS":"COMPLETED",...(action==="PICKUP"?{tripStartedAt:now}:{completedAt:now})}});
    await tx.bookingEvent.create({data:{...(isParcel?{parcelBookingId:booking.id}:{rideBookingId:booking.id}),actorUserId:driverUserId,eventType:action==="PICKUP"?"PICKUP_VERIFIED":"COMPLETION_VERIFIED",fromStatus:a.status,toStatus:nextStatus,metadata:{assignmentId:a.id,...(a.deliveryLegId?{deliveryLegId:a.deliveryLegId}:{}),...(nextDeliveryLegId?{nextDeliveryLegId}:{})}}});
    if(action==="DELIVERY"){await tx.driverProfile.update({where:{id:a.driverProfileId},data:{completedJobs:{increment:1}}});if(a.driverProfile.kycTier==="FULL")await tx.driverPayout.upsert({where:{idempotencyKey:"completion-"+a.id},create:{driverProfileId:a.driverProfileId,...(a.parcelBookingId?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),amountMinor:a.agreedFareMinor,currency:a.currency,status:"PENDING",provider:"PAYSTACK",idempotencyKey:"completion-"+a.id},update:{}});}
    return {id:a.id,status:nextStatus,bookingStatus:action==="PICKUP"?(isParcel?"PICKED_UP":"TRIP_IN_PROGRESS"):isParcel?(finalDeliveryLeg?"COMPLETED":"IN_TRANSIT"):"COMPLETED",nextDeliveryLegId,verifiedAt:now};
   });
  },
 };
}

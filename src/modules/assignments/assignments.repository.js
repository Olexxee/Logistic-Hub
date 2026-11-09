import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { activeServiceZoneWhere, eligibleParcelAssignmentDriverWhere, eligibleVehicleWhere, parcelCapabilityForLegType } from "../drivers/driver-dispatch-eligibility.js";

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

async function serializableTransaction(prismaClient, callback) {
 for (let attempt = 0; ; attempt += 1) {
  try {
   return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" });
  } catch (error) {
   if (error?.code !== "P2034" || attempt >= 2) throw error;
  }
 }
}

export const MAX_VERIFICATION_CODE_ATTEMPTS = 5;

async function findParcelExecutionEligibility(tx, assignment, now) {
 if (!assignment.parcelBookingId) return null;
 const capability = parcelCapabilityForLegType(assignment.deliveryLeg?.type ?? "DIRECT");
 if (!capability) return {
  code: "LEG_REQUIRES_PARTNER_EXECUTION",
  message: "This delivery leg is reserved for transport-partner execution.",
 };
 if (!assignment.vehicleId) return {
  code: "VEHICLE_NOT_BOUND",
  message: "This assignment has no selected operating vehicle. Operations must review it before pickup.",
 };
 const strictMode = env.DRIVER_KYC_MODE === "STRICT";
 const booking = assignment.parcelBooking;
 const leg = assignment.deliveryLeg;
 const originServiceZoneId = leg?.originServiceZoneId ?? booking?.pickupServiceZoneId;
 const destinationServiceZoneId = leg?.destinationServiceZoneId ?? booking?.destinationServiceZoneId;
 if (!originServiceZoneId || !destinationServiceZoneId) return {
  code: "SERVICE_ZONE_UNAVAILABLE",
  message: "The assignment does not have a complete origin and destination service-zone route.",
 };
 const requiredServiceZoneIds = [...new Set([originServiceZoneId, destinationServiceZoneId])];
 const activeZones = await tx.serviceZone.findMany({
  where: { id: { in: requiredServiceZoneIds }, ...activeServiceZoneWhere(now) },
  select: { id: true },
 });
 if (activeZones.length !== requiredServiceZoneIds.length) return {
  code: "SERVICE_ZONE_UNAVAILABLE",
  message: "The origin or destination service zone is no longer active for parcel delivery.",
 };
 const hubIds = [...new Set([
  leg?.originHubPointId,
  leg?.destinationHubPointId,
 ].filter(Boolean))];
 if (hubIds.length) {
  const activeHubs = await tx.hubPoint.findMany({
   where: { id: { in: hubIds }, status: "ACTIVE" },
   select: { id: true },
  });
  if (activeHubs.length !== hubIds.length) return {
   code: "HUB_UNAVAILABLE",
   message: "An origin or destination hub on this assignment is no longer active.",
  };
 }
 const kycTiers = env.DRIVER_KYC_MODE === "TEST" && capability === "LOCAL_DISPATCH"
  ? ["FULL", "TEST_LIMITED"]
  : ["FULL"];
 const driver = await tx.driverProfile.findFirst({
  where: eligibleParcelAssignmentDriverWhere({
   driverProfileId: assignment.driverProfileId, capability, now, strictMode, kycTiers, requiredServiceZoneIds,
  }),
  select: { id: true },
 });
 if (!driver) return {
  code: "DRIVER_EXECUTION_ELIGIBILITY_CHANGED",
  message: "Driver approval, account status, or required identity evidence is no longer valid for this pickup.",
 };
 const vehicle = await tx.vehicle.findFirst({
  where: {
   id: assignment.vehicleId,
   ...eligibleVehicleWhere({
    driverProfileId: assignment.driverProfileId, capability, now, strictMode,
   }),
  },
  select: { id: true },
 });
 if (!vehicle) return {
  code: "VEHICLE_EXECUTION_ELIGIBILITY_CHANGED",
  message: "The selected vehicle is no longer active, verified, or approved for this service.",
 };
 return null;
}
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
      vehicle:{select:{id:true,type:true,make:true,model:true,registrationPlate:true}},
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
  findAssignment(id) { return prismaClient.driverAssignment.findUnique({where:{id},include:{driverProfile:{select:{id:true,userId:true,verificationStatus:true,kycTier:true,suspendedAt:true}},vehicle:{select:{id:true,type:true,make:true,model:true,registrationPlate:true}},parcelBooking:true,rideBooking:true}}); },
  lockAssignment(id, tx = prismaClient) {
   return tx.$queryRaw`SELECT "id" FROM "driver_assignments" WHERE "id" = ${id} FOR UPDATE`;
  },
  listExecutionHolds({skip=0,take=25}={},tx=prismaClient) {
   const where={parcelBookingId:{not:null},executionHoldAt:{not:null},status:{notIn:["COMPLETED","CANCELLED","FAILED"]}};
   return Promise.all([
    tx.driverAssignment.findMany({
     where,skip,take,
     orderBy:[{executionHoldAt:"desc"},{id:"desc"}],
     include:{
      parcelBooking:{select:{id:true,publicReference:true,status:true}},
      deliveryLeg:{select:{id:true,sequence:true,type:true,status:true}},
      driverProfile:{select:{id:true,userId:true,user:{select:{fullName:true,email:true,phone:true}}}},
      vehicle:{select:{id:true,type:true,make:true,model:true,registrationPlate:true}},
     },
    }),
    tx.driverAssignment.count({where}),
   ]).then(([items,total])=>({items,total}));
  },
  lockAssignment(id, tx = prismaClient) {
   return tx.$queryRaw`SELECT "id" FROM "driver_assignments" WHERE "id" = ${id} FOR UPDATE`;
  },
  lockDeliveryLeg(id, tx = prismaClient) {
   return tx.$queryRaw`SELECT "id" FROM "delivery_legs" WHERE "id" = ${id} FOR UPDATE`;
  },
  lockRecovery(id, tx = prismaClient) {
   return tx.$queryRaw`SELECT "id" FROM "driver_assignment_recoveries" WHERE "id" = ${id} FOR UPDATE`;
  },
  lockRecoveryCandidate(driverProfileId, vehicleId, tx = prismaClient) {
   return tx.$queryRaw`SELECT "id" FROM "driver_profiles" WHERE "id" = ${driverProfileId} FOR UPDATE`
    .then(() => tx.$queryRaw`SELECT "id" FROM "vehicles" WHERE "id" = ${vehicleId} FOR UPDATE`);
  },
  findAssignmentForRecovery(id, tx = prismaClient) {
   return tx.driverAssignment.findUnique({
    where: { id },
    include: {
     parcelBooking: true,
     deliveryLeg: true,
     driverProfile: { select: { id: true, userId: true } },
     vehicle: { select: { id: true } },
    },
   });
  },
  findActiveRecoveryForSource(sourceAssignmentId, tx = prismaClient) {
   return tx.driverAssignmentRecovery.findFirst({
    where: { sourceAssignmentId, status: { in: ["PENDING_RELEASE", "PENDING_RECEIPT"] } },
   });
  },
  findRecoveryForUpdate(id, tx = prismaClient) {
   return tx.driverAssignmentRecovery.findUnique({
    where: { id },
    include: {
     sourceAssignment: { include: { parcelBooking: true, deliveryLeg: true, driverProfile: { select: { id: true, userId: true } } } },
     replacementDriverProfile: { include: { user: { select: { id: true, status: true, role: true, emailVerifiedAt: true } } } },
     replacementVehicle: true,
     operationalCase: { select: { id: true, status: true, priority: true } },
    },
   });
  },
  checkRecoveryCandidate(tx, { sourceAssignment, replacementDriverProfileId, replacementVehicleId, now }) {
   return (async () => {
    const candidateAssignment = {
     ...sourceAssignment,
     driverProfileId: replacementDriverProfileId,
     vehicleId: replacementVehicleId,
    };
    const eligibility = await findParcelExecutionEligibility(tx, candidateAssignment, now);
    if (eligibility) return { ineligible: eligibility };
    const driver = await tx.driverProfile.findUnique({
     where: { id: replacementDriverProfileId },
     select: { id: true, isOnline: true, isAvailable: true },
    });
    if (!driver || !driver.isOnline || !driver.isAvailable) return { blocker: "REPLACEMENT_DRIVER_UNAVAILABLE" };
    const activeAssignment = await tx.driverAssignment.findFirst({
     where: { driverProfileId: replacementDriverProfileId, status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] } },
     select: { id: true },
    });
    if (activeAssignment) return { blocker: "REPLACEMENT_DRIVER_ALREADY_ASSIGNED" };
    const activeVehicleAssignment = await tx.driverAssignment.findFirst({
     where: { vehicleId: replacementVehicleId, status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] } },
     select: { id: true },
    });
    if (activeVehicleAssignment) return { blocker: "REPLACEMENT_VEHICLE_ALREADY_ASSIGNED" };
    return { eligible: true };
   })();
  },
  createAssignmentRecovery(data, tx = prismaClient) {
   return tx.driverAssignmentRecovery.create({ data });
  },
  updateAssignmentRecovery(id, data, tx = prismaClient) {
   return tx.driverAssignmentRecovery.update({ where: { id }, data });
  },
  createRecoveryReplacementAssignment(data, tx = prismaClient) {
   return tx.driverAssignment.create({ data });
  },
  updateAssignmentForRecovery(id, data, tx = prismaClient) {
   return tx.driverAssignment.update({ where: { id }, data });
  },
  updateRecoveryDriverAvailability(id, isAvailable, tx = prismaClient) {
   return tx.driverProfile.update({ where: { id }, data: { isAvailable } });
  },
  findAssignmentForAdminHold(id, tx = prismaClient) {
   return tx.driverAssignment.findUnique({where:{id},include:{parcelBooking:{select:{id:true,publicReference:true}},deliveryLeg:{select:{id:true,sequence:true}},driverProfile:{select:{id:true,userId:true}},vehicle:{select:{id:true}}}});
  },
  updateExecutionHold(id, data, tx = prismaClient) {
   return tx.driverAssignment.update({where:{id},data});
  },
  createSafetyHoldCase(data, tx = prismaClient) {
   return tx.operationalCase.create({data});
  },
  createOperationalAudit(data, tx = prismaClient) {
   return tx.operationalAuditEvent.create({data});
  },
  revokeAssignmentVerificationCodes(assignment, tx = prismaClient) {
   return tx.verificationToken.updateMany({
    where:{...(assignment.parcelBookingId?{parcelBookingId:assignment.parcelBookingId}:{}),...(assignment.deliveryLegId?{deliveryLegId:assignment.deliveryLegId}:{}),status:"ACTIVE"},
    data:{status:"REVOKED"},
   });
  },
  createAssignmentBookingEvent(data, tx = prismaClient) {
   return tx.bookingEvent.create({data});
  },
  findOwnerLocation({assignment,now}) {
   const booking=assignment.parcelBooking||assignment.rideBooking;
   return prismaClient.driverLocation.findFirst({where:{driverProfileId:assignment.driverProfileId,recordedAt:{gte:new Date(now.getTime()-2*60*1000)}},orderBy:{recordedAt:"desc"},select:{latitude:true,longitude:true,accuracyMeters:true,recordedAt:true}});
  },
  issueCode({assignment,action,tokenHash,expiresAt,now}) {
   return serializableTransaction(prismaClient, async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "driver_assignments" WHERE "id" = ${assignment.id} FOR UPDATE`;
    const fresh=await tx.driverAssignment.findUnique({where:{id:assignment.id},include:{parcelBooking:true,rideBooking:true}});
    if(!fresh||fresh.status==="COMPLETED"||fresh.status==="CANCELLED")return null;
    if(fresh.executionHoldAt) return {held:true,holdAt:fresh.executionHoldAt};
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
   return serializableTransaction(prismaClient, async tx=>{
    const a=await tx.driverAssignment.findUnique({where:{id:assignmentId},include:{driverProfile:true,parcelBooking:true,rideBooking:true,deliveryLeg:true}});
    if(!a)return null;
    if(a.driverProfile.userId!==driverUserId) return {forbidden:true};
    if(!a.parcelBookingId && !a.rideBookingId) return {forbidden:true};
    if(a.executionHoldAt) return {held:true,holdAt:a.executionHoldAt};
    if(a.rideBookingId && (a.driverProfile.verificationStatus!=="VERIFIED" || a.driverProfile.suspendedAt || a.driverProfile.kycTier!=="FULL")) return {forbidden:true};
    if(!isAllowedAssignmentTransition(a.status,nextStatus))return {conflict:true,status:a.status};
    if(a.parcelBookingId && nextStatus==="ARRIVED_AT_PICKUP") {
     const ineligible = await findParcelExecutionEligibility(tx, a, now);
     if(ineligible) return {ineligible};
    }
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
   return serializableTransaction(prismaClient, async tx=>{
    const a=await tx.driverAssignment.findUnique({where:{id:assignmentId},include:{driverProfile:true,parcelBooking:true,rideBooking:true,deliveryLeg:true}});
    if(!a)return null;
    if(a.driverProfile.userId!==driverUserId)return {forbidden:true};
    if(!a.parcelBookingId && !a.rideBookingId) return {forbidden:true};
    if(a.executionHoldAt) return {held:true,holdAt:a.executionHoldAt};
    const isParcel=Boolean(a.parcelBookingId);const booking=a.parcelBooking||a.rideBooking;
    if(!isParcel && (a.driverProfile.verificationStatus!=="VERIFIED" || a.driverProfile.suspendedAt || a.driverProfile.kycTier!=="FULL")) return {forbidden:true};
    const eligibilityIssue = isParcel
     ? await findParcelExecutionEligibility(tx, a, now)
     : null;
    if(isParcel && action==="PICKUP" && eligibilityIssue) return {ineligible:eligibilityIssue};
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
    if(isParcel && action==="DELIVERY" && eligibilityIssue) {
     await tx.bookingEvent.create({data:{
      parcelBookingId:booking.id,actorUserId:driverUserId,
      eventType:"IN_CUSTODY_ELIGIBILITY_EXCEPTION_COMPLETED",
      fromStatus:a.status,toStatus:nextStatus,
      metadata:{
       assignmentId:a.id,driverProfileId:a.driverProfileId,vehicleId:a.vehicleId,
       reasonCode:eligibilityIssue.code,
       policy:"ALLOW_EXISTING_CUSTODY_COMPLETION",
      },
     }});
    }
    if(action==="DELIVERY"){await tx.driverProfile.update({where:{id:a.driverProfileId},data:{completedJobs:{increment:1}}});if(a.driverProfile.kycTier==="FULL"&&!a.payoutReviewRequired)await tx.driverPayout.upsert({where:{idempotencyKey:"completion-"+a.id},create:{driverProfileId:a.driverProfileId,...(a.parcelBookingId?{parcelBookingId:a.parcelBookingId}:{rideBookingId:a.rideBookingId}),amountMinor:a.agreedFareMinor,currency:a.currency,status:"PENDING",provider:"PAYSTACK",idempotencyKey:"completion-"+a.id},update:{}});}
    return {id:a.id,status:nextStatus,bookingStatus:action==="PICKUP"?(isParcel?"PICKED_UP":"TRIP_IN_PROGRESS"):isParcel?(finalDeliveryLeg?"COMPLETED":"IN_TRANSIT"):"COMPLETED",nextDeliveryLegId,verifiedAt:now};
   });
  },
 };
}

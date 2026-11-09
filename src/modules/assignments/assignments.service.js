import { createHash, randomInt, randomUUID } from "node:crypto";
import { createAssignmentsRepository } from "./assignments.repository.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";
async function serializableTransaction(prismaClient,callback){
 for(let attempt=0;;attempt+=1){
  try{return await prismaClient.$transaction(callback,{isolationLevel:"Serializable"});}
  catch(error){if(error?.code!=="P2034"||attempt>=2)throw error;}
 }
}
export function createAssignmentsService({prismaClient,clock=()=>new Date()}){
 const repository=createAssignmentsRepository(prismaClient);
 return {
  async initiateCustodyRecovery({assignmentId,replacementDriverProfileId,replacementVehicleId,actorUserId,reason}) {
   return serializableTransaction(prismaClient, async tx => {
    const snapshot=await repository.findAssignmentForRecovery(assignmentId,tx);
    if(!snapshot)return {notFound:true};
    if(!snapshot.deliveryLegId)return {blocker:"PARCEL_DELIVERY_LEG_REQUIRED"};
    await repository.lockDeliveryLeg(snapshot.deliveryLegId,tx);
    await repository.lockAssignment(assignmentId,tx);
    const source=await repository.findAssignmentForRecovery(assignmentId,tx);
    if(!source)return {notFound:true};
    if(!source.parcelBookingId||!source.deliveryLegId)return {blocker:"PARCEL_DELIVERY_LEG_REQUIRED"};
    if(!source.executionHoldAt||!source.executionHoldOperationalCaseId)return {blocker:"ACTIVE_SAFETY_HOLD_REQUIRED"};
    if(!["PICKUP_CONFIRMED","IN_PROGRESS"].includes(source.status)||!source.pickupAt)return {blocker:"ASSIGNMENT_NOT_IN_CUSTODY"};
    if(source.driverProfileId===replacementDriverProfileId)return {blocker:"REPLACEMENT_DRIVER_MUST_DIFFER"};
    if(source.vehicleId===replacementVehicleId)return {blocker:"REPLACEMENT_VEHICLE_MUST_DIFFER"};
    await repository.lockDeliveryLeg(source.deliveryLegId,tx);
    const existing=await repository.findActiveRecoveryForSource(source.id,tx);
    if(existing)return {recovery:existing,replay:true};
    await repository.lockRecoveryCandidate(replacementDriverProfileId,replacementVehicleId,tx);
    const candidate=await repository.checkRecoveryCandidate(tx,{
     sourceAssignment:source,replacementDriverProfileId,replacementVehicleId,now:clock(),
    });
    if(!candidate.eligible)return candidate;
    const recovery=await repository.createAssignmentRecovery({
     parcelBookingId:source.parcelBookingId,
     deliveryLegId:source.deliveryLegId,
     sourceAssignmentId:source.id,
     replacementDriverProfileId,
     replacementVehicleId,
     operationalCaseId:source.executionHoldOperationalCaseId,
     initiatedByUserId:actorUserId,
     status:"PENDING_RELEASE",
     reason,
    },tx);
    await repository.createOperationalAudit({
     actorUserId,entityType:"DRIVER_ASSIGNMENT_RECOVERY",entityId:recovery.id,
     action:"DRIVER_ASSIGNMENT_RECOVERY_INITIATED",reason,
     before:{sourceAssignmentId:source.id,sourceDriverProfileId:source.driverProfileId,sourceVehicleId:source.vehicleId},
     after:{status:recovery.status,replacementDriverProfileId,replacementVehicleId,operationalCaseId:recovery.operationalCaseId},
     metadata:{parcelBookingId:source.parcelBookingId,deliveryLegId:source.deliveryLegId},
    },tx);
    return {recovery,replay:false};
   });
  },
  async confirmCustodyRecoveryRelease({recoveryId,userId,reason,evidence}) {
   return serializableTransaction(prismaClient,async tx=>{
    await repository.lockRecovery(recoveryId,tx);
    const recovery=await repository.findRecoveryForUpdate(recoveryId,tx);
    if(!recovery)return {notFound:true};
    if(recovery.status==="PENDING_RECEIPT"&&recovery.releaseConfirmedByUserId===userId)return {recovery,replay:true};
    if(recovery.status!=="PENDING_RELEASE")return {blocker:"RECOVERY_NOT_AWAITING_RELEASE"};
    await repository.lockAssignment(recovery.sourceAssignmentId,tx);
    const source=await repository.findAssignmentForRecovery(recovery.sourceAssignmentId,tx);
    if(!source||source.driverProfile.userId!==userId)return {forbidden:true};
    if(!source.executionHoldAt||!["PICKUP_CONFIRMED","IN_PROGRESS"].includes(source.status))return {blocker:"SOURCE_ASSIGNMENT_NOT_RECOVERABLE"};
    const now=clock();
    const updated=await repository.updateAssignmentRecovery(recoveryId,{
     status:"PENDING_RECEIPT",releaseConfirmedByUserId:userId,releaseConfirmedAt:now,
     releaseReason:reason,releaseEvidence:evidence??undefined,
    },tx);
    await repository.createOperationalAudit({
     actorUserId:userId,entityType:"DRIVER_ASSIGNMENT_RECOVERY",entityId:recoveryId,
     action:"DRIVER_CUSTODY_RELEASE_CONFIRMED",reason,
     before:{status:"PENDING_RELEASE"},after:{status:"PENDING_RECEIPT",releaseConfirmedAt:now.toISOString()},
     metadata:{sourceAssignmentId:source.id,replacementDriverProfileId:recovery.replacementDriverProfileId},
    },tx);
    return {recovery:updated,replay:false};
   });
  },
  async authorizeCustodyRecoveryReleaseException({recoveryId,actorUserId,reason,evidence}) {
   return serializableTransaction(prismaClient,async tx=>{
    await repository.lockRecovery(recoveryId,tx);
    const recovery=await repository.findRecoveryForUpdate(recoveryId,tx);
    if(!recovery)return {notFound:true};
    if(recovery.status==="PENDING_RECEIPT"&&recovery.exceptionAuthorizedByUserId===actorUserId)return {recovery,replay:true};
    if(recovery.status!=="PENDING_RELEASE")return {blocker:"RECOVERY_NOT_AWAITING_RELEASE"};
    await repository.lockAssignment(recovery.sourceAssignmentId,tx);
    const source=await repository.findAssignmentForRecovery(recovery.sourceAssignmentId,tx);
    if(!source||!source.executionHoldAt||!["PICKUP_CONFIRMED","IN_PROGRESS"].includes(source.status))return {blocker:"SOURCE_ASSIGNMENT_NOT_RECOVERABLE"};
    const now=clock();
    const updated=await repository.updateAssignmentRecovery(recoveryId,{
     status:"PENDING_RECEIPT",exceptionAuthorizedByUserId:actorUserId,
     exceptionAuthorizedAt:now,exceptionReason:reason,exceptionEvidence:evidence,
    },tx);
    await repository.createOperationalAudit({
     actorUserId,entityType:"DRIVER_ASSIGNMENT_RECOVERY",entityId:recoveryId,
     action:"DRIVER_CUSTODY_RELEASE_EXCEPTION_AUTHORIZED",reason,
     before:{status:"PENDING_RELEASE"},after:{status:"PENDING_RECEIPT",exceptionAuthorizedAt:now.toISOString()},
     metadata:{sourceAssignmentId:source.id,replacementDriverProfileId:recovery.replacementDriverProfileId,evidenceCount:evidence.length},
    },tx);
    return {recovery:updated,replay:false};
   });
  },
  async confirmCustodyRecoveryReceipt({recoveryId,userId,conditionAtReceipt,evidence}) {
   return serializableTransaction(prismaClient,async tx=>{
    await repository.lockRecovery(recoveryId,tx);
    const recovery=await repository.findRecoveryForUpdate(recoveryId,tx);
    if(!recovery)return {notFound:true};
    if(recovery.status==="CONFIRMED"&&recovery.receiptConfirmedByUserId===userId)return {recovery,replay:true};
    if(recovery.status!=="PENDING_RECEIPT")return {blocker:"RECOVERY_NOT_AWAITING_RECEIPT"};
    await repository.lockDeliveryLeg(recovery.deliveryLegId,tx);
    await repository.lockAssignment(recovery.sourceAssignmentId,tx);
    await repository.lockRecoveryCandidate(recovery.replacementDriverProfileId,recovery.replacementVehicleId,tx);
    const source=await repository.findAssignmentForRecovery(recovery.sourceAssignmentId,tx);
    if(!source||!source.executionHoldAt||!["PICKUP_CONFIRMED","IN_PROGRESS"].includes(source.status))return {blocker:"SOURCE_ASSIGNMENT_NOT_RECOVERABLE"};
    if(recovery.replacementDriverProfile?.userId!==userId)return {forbidden:true};
    const candidate=await repository.checkRecoveryCandidate(tx,{
     sourceAssignment:source,
     replacementDriverProfileId:recovery.replacementDriverProfileId,
     replacementVehicleId:recovery.replacementVehicleId,
     now:clock(),
    });
    if(!candidate.eligible)return candidate;
    const now=clock();
    const replacementAssignment=await repository.createRecoveryReplacementAssignment({
     parcelBookingId:source.parcelBookingId,
     deliveryLegId:source.deliveryLegId,
     driverProfileId:recovery.replacementDriverProfileId,
     vehicleId:recovery.replacementVehicleId,
     assignedByUserId:recovery.initiatedByUserId,
     status:"IN_PROGRESS",
     agreedFareMinor:source.agreedFareMinor,
     currency:source.currency,
     reservedAt:now,
     acceptedAt:now,
     pickupAt:source.pickupAt,
     startedAt:now,
     payoutReviewRequired:true,
    },tx);
    await repository.updateAssignmentForRecovery(source.id,{
     status:"FAILED",
     failureReason:`CUSTODY_RECOVERED_TO_ASSIGNMENT:${replacementAssignment.id}`,
     executionHoldAt:null,
    },tx);
    await repository.updateRecoveryDriverAvailability(recovery.replacementDriverProfileId,false,tx);
    const updated=await repository.updateAssignmentRecovery(recoveryId,{
     status:"CONFIRMED",replacementAssignmentId:replacementAssignment.id,
     receiptConfirmedByUserId:userId,receiptConfirmedAt:now,
     receiptCondition:conditionAtReceipt,receiptEvidence:evidence??undefined,
    },tx);
    await repository.createAssignmentBookingEvent({
     parcelBookingId:source.parcelBookingId,actorUserId:userId,
     eventType:"DRIVER_ASSIGNMENT_CUSTODY_RECOVERED",
     fromStatus:source.status,toStatus:"IN_PROGRESS",
     metadata:{
      recoveryId,sourceAssignmentId:source.id,replacementAssignmentId:replacementAssignment.id,
      sourceDriverProfileId:source.driverProfileId,replacementDriverProfileId:recovery.replacementDriverProfileId,
      sourceVehicleId:source.vehicleId,replacementVehicleId:recovery.replacementVehicleId,
      operationalCaseId:recovery.operationalCaseId,payoutReviewRequired:true,
     },
    },tx);
    await repository.createOperationalAudit({
     actorUserId:userId,entityType:"DRIVER_ASSIGNMENT_RECOVERY",entityId:recoveryId,
     action:"DRIVER_CUSTODY_RECOVERY_CONFIRMED",
     reason:conditionAtReceipt,
     before:{status:"PENDING_RECEIPT",sourceAssignmentStatus:source.status},
     after:{status:"CONFIRMED",sourceAssignmentStatus:"FAILED",replacementAssignmentId:replacementAssignment.id,receiptConfirmedAt:now.toISOString()},
     metadata:{operationalCaseId:recovery.operationalCaseId,manualPayoutReviewRequired:true},
    },tx);
    return {recovery:updated,replacementAssignment,replay:false};
   });
  },
  async placeExecutionHold({assignmentId,actorUserId,reason}) {
   return serializableTransaction(prismaClient, async tx => {
    await repository.lockAssignment(assignmentId,tx);
    const assignment = await repository.findAssignmentForAdminHold(assignmentId, tx);
    if (!assignment) return {notFound:true};
    if (!assignment.parcelBookingId) return {blocker:"PARCEL_ASSIGNMENT_REQUIRED"};
    if (["COMPLETED","CANCELLED","FAILED"].includes(assignment.status)) return {blocker:"ASSIGNMENT_TERMINAL"};
    if (assignment.executionHoldAt) return {assignmentId,heldAt:assignment.executionHoldAt,caseId:assignment.executionHoldOperationalCaseId,replay:true};
    const heldAt=clock();
    const operationalCase=await repository.createSafetyHoldCase({
     publicReference:`OPS-${randomUUID().replaceAll("-","").slice(0,12).toUpperCase()}`,
     type:"SAFETY_INCIDENT",status:"OPEN",priority:"CRITICAL",
     parcelBookingId:assignment.parcelBookingId,
     ...(assignment.deliveryLegId?{deliveryLegId:assignment.deliveryLegId}:{}),
     reportedByUserId:actorUserId,
     title:"Parcel assignment placed on safety hold",
     description:`Admin safety hold for assignment ${assignmentId}. Reason: ${reason}`,
     evidence:{assignmentId,driverProfileId:assignment.driverProfileId,vehicleId:assignment.vehicleId??null,holdReason:reason},
    },tx);
    await repository.updateExecutionHold(assignmentId,{executionHoldAt:heldAt,executionHoldReason:reason,executionHoldActorUserId:actorUserId,executionHoldOperationalCaseId:operationalCase.id},tx);
    await repository.revokeAssignmentVerificationCodes(assignment,tx);
    await repository.createOperationalAudit({
     actorUserId,entityType:"DRIVER_ASSIGNMENT",entityId:assignmentId,
     action:"ASSIGNMENT_EXECUTION_HELD",reason,
     before:{status:assignment.status,executionHoldAt:null},
     after:{status:assignment.status,executionHoldAt:heldAt.toISOString(),operationalCaseId:operationalCase.id},
     metadata:{parcelBookingId:assignment.parcelBookingId,deliveryLegId:assignment.deliveryLegId??null},
    },tx);
    return {assignmentId,heldAt,caseId:operationalCase.id,replay:false};
   });
  },
  async releaseExecutionHold({assignmentId,actorUserId,reason}) {
   return serializableTransaction(prismaClient, async tx => {
    await repository.lockAssignment(assignmentId,tx);
    const assignment=await repository.findAssignmentForAdminHold(assignmentId,tx);
    if(!assignment)return {notFound:true};
    if(!assignment.executionHoldAt)return {blocker:"ASSIGNMENT_NOT_HELD"};
    const caseId=assignment.executionHoldOperationalCaseId;
    const before={executionHoldAt:assignment.executionHoldAt.toISOString(),executionHoldReason:assignment.executionHoldReason,operationalCaseId:caseId};
    await repository.updateExecutionHold(assignmentId,{executionHoldAt:null,executionHoldReason:null,executionHoldActorUserId:null,executionHoldOperationalCaseId:null},tx);
    await repository.createOperationalAudit({
     actorUserId,entityType:"DRIVER_ASSIGNMENT",entityId:assignmentId,
     action:"ASSIGNMENT_EXECUTION_HOLD_RELEASED",reason,
     before,after:{executionHoldAt:null,releaseReason:reason},
     metadata:{operationalCaseId:caseId},
    },tx);
    return {assignmentId,releasedAt:clock(),caseId,replay:false};
   });
  },
  async listExecutionHolds({page=1,limit=25}) {
   const result=await repository.listExecutionHolds({skip:(page-1)*limit,take:limit});
   return {
    items:result.items.map(assignment=>({
     assignmentId:assignment.id,
     status:assignment.status,
     heldAt:assignment.executionHoldAt,
     reason:assignment.executionHoldReason,
     heldByUserId:assignment.executionHoldActorUserId,
     operationalCaseId:assignment.executionHoldOperationalCaseId,
     booking:assignment.parcelBooking,
     deliveryLeg:assignment.deliveryLeg,
     driver:{id:assignment.driverProfile.id,userId:assignment.driverProfile.userId,user:assignment.driverProfile.user},
     vehicle:assignment.vehicle,
     createdAt:assignment.createdAt,
     updatedAt:assignment.updatedAt,
    })),
    pagination:{page,limit,total:result.total,totalPages:Math.ceil(result.total/limit)},
   };
  },
  async listMine({userId,page=1,limit=20}){
   const result=await repository.listDriverAssignments({userId,skip:(page-1)*limit,take:limit});
   return {
    items:result.items.map(assignment=>({
     id:assignment.id,
     status:assignment.status,
     agreedFareMinor:assignment.agreedFareMinor.toString(),
     currency:assignment.currency,
     acceptedAt:assignment.acceptedAt,
     pickupAt:assignment.pickupAt,
     startedAt:assignment.startedAt,
     completedAt:assignment.completedAt,
     failureReason:assignment.failureReason,
     executionHeld:Boolean(assignment.executionHoldAt),
     vehicle:assignment.vehicle?{id:assignment.vehicle.id,type:assignment.vehicle.type,make:assignment.vehicle.make,model:assignment.vehicle.model,registrationPlate:assignment.vehicle.registrationPlate}:null,
     createdAt:assignment.createdAt,
     updatedAt:assignment.updatedAt,
     booking:{
      id:assignment.parcelBooking.id,
      publicReference:assignment.parcelBooking.publicReference,
      status:assignment.parcelBooking.status,
      paymentStatus:assignment.parcelBooking.paymentStatus,
      pickupAddress:assignment.parcelBooking.pickupAddress,
      pickupInstructions:assignment.parcelBooking.pickupInstructions,
      destinationAddress:assignment.parcelBooking.destinationAddress,
      recipientName:assignment.parcelBooking.recipientName,
      recipientPhone:assignment.parcelBooking.recipientPhone,
      parcelCategory:assignment.parcelBooking.parcelCategory,
      parcelDescription:assignment.parcelBooking.parcelDescription,
      parcelSize:assignment.parcelBooking.parcelSize,
      handlingInstructions:assignment.parcelBooking.handlingInstructions,
     },
     deliveryLeg:assignment.deliveryLeg?{
      id:assignment.deliveryLeg.id,
      sequence:assignment.deliveryLeg.sequence,
      type:assignment.deliveryLeg.type,
      status:assignment.deliveryLeg.status,
      origin:{
       serviceZone:assignment.deliveryLeg.originServiceZone,
       hub:assignment.deliveryLeg.originHubPoint,
       address:assignment.deliveryLeg.originHubPoint?.address??assignment.parcelBooking.pickupAddress,
       latitude:assignment.deliveryLeg.originLatitude?.toString()??assignment.parcelBooking.pickupLatitude.toString(),
       longitude:assignment.deliveryLeg.originLongitude?.toString()??assignment.parcelBooking.pickupLongitude.toString(),
      },
      destination:{
       serviceZone:assignment.deliveryLeg.destinationServiceZone,
       hub:assignment.deliveryLeg.destinationHubPoint,
       address:assignment.deliveryLeg.destinationHubPoint?.address??assignment.parcelBooking.destinationAddress,
       latitude:assignment.deliveryLeg.destinationLatitude?.toString()??assignment.parcelBooking.destinationLatitude.toString(),
       longitude:assignment.deliveryLeg.destinationLongitude?.toString()??assignment.parcelBooking.destinationLongitude.toString(),
      },
     }:null,
    })),
    pagination:{page,limit,total:result.total,totalPages:Math.ceil(result.total/limit)},
   };
  },
  async markArrived({assignmentId,userId}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");if(a.driverProfile.userId!==userId)throw new ForbiddenError();const result=await repository.transition({assignmentId,driverUserId:userId,nextStatus:"ARRIVED_AT_PICKUP",now:clock()});if(result?.conflict)throw new ConflictError("Assignment is not in a state that allows arrival at pickup.","ASSIGNMENT_STATE_CONFLICT");if(result?.forbidden)throw new ForbiddenError();if(result?.held)throw new ConflictError("This assignment is under an Admin safety hold. Operations must resolve the hold before driver actions can continue.","ASSIGNMENT_EXECUTION_HELD");if(result?.ineligible)throw new ConflictError(result.ineligible.message,result.ineligible.code);return result;},
  async startTrip({assignmentId,userId}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");if(a.driverProfile.userId!==userId)throw new ForbiddenError();const result=await repository.transition({assignmentId,driverUserId:userId,nextStatus:"IN_PROGRESS",now:clock()});if(result?.conflict)throw new ConflictError("Pickup must be verified before starting the trip.","ASSIGNMENT_STATE_CONFLICT");if(result?.forbidden)throw new ForbiddenError();if(result?.held)throw new ConflictError("This assignment is under an Admin safety hold. Operations must resolve the hold before driver actions can continue.","ASSIGNMENT_EXECUTION_HELD");return result;},
  async markDestination({assignmentId,userId}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");if(a.driverProfile.userId!==userId)throw new ForbiddenError();const result=await repository.transition({assignmentId,driverUserId:userId,nextStatus:"ARRIVED_AT_DESTINATION",now:clock()});if(result?.conflict)throw new ConflictError("Pickup must be verified and the trip started before arriving at destination.","ASSIGNMENT_STATE_CONFLICT");if(result?.forbidden)throw new ForbiddenError();if(result?.held)throw new ConflictError("This assignment is under an Admin safety hold. Operations must resolve the hold before driver actions can continue.","ASSIGNMENT_EXECUTION_HELD");return result;},
  async issueCode({assignmentId,user,action}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");const booking=a.parcelBooking||a.rideBooking;const ownerId=a.parcelBooking?booking.senderId:booking.passengerId;if(user.id!==ownerId)throw new ForbiddenError("Only the booking owner can request a verification code.");const code=String(randomInt(0,1000000)).padStart(6,"0");const result=await repository.issueCode({assignment:a,action,tokenHash:createHash("sha256").update(code).digest("hex"),expiresAt:new Date(clock().getTime()+10*60_000),now:clock()});if(!result)throw new ConflictError("Assignment is no longer active.");if(result.held)throw new ConflictError("This assignment is under an Admin safety hold. Verification codes are disabled until operations resolves the hold.","ASSIGNMENT_EXECUTION_HELD");if(result.conflict)throw new ConflictError("The driver must arrive at the relevant stop before a code can be issued.","ASSIGNMENT_STATE_CONFLICT");return {assignmentId,action,code,expiresInSeconds:600,note:"Share this one-time code only with your assigned driver."};},
  async verifyCode({assignmentId,userId,action,code}){const result=await repository.verifyCode({assignmentId,driverUserId:userId,action,tokenHash:createHash("sha256").update(code).digest("hex"),now:clock()});if(!result)throw new NotFoundError("Assignment not found.");if(result.forbidden)throw new ForbiddenError();if(result.ineligible)throw new ConflictError(result.ineligible.message,result.ineligible.code);if(result.held)throw new ConflictError("This assignment is under an Admin safety hold. Verification is blocked until operations resolves the hold.","ASSIGNMENT_EXECUTION_HELD");if(result.invalid)throw new ConflictError("The verification code is invalid or expired.","INVALID_VERIFICATION_CODE");if(result.conflict)throw new ConflictError("Assignment is not in the state required for this verification.","ASSIGNMENT_STATE_CONFLICT");return result;},
  async location({assignmentId,user}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");const booking=a.parcelBooking||a.rideBooking;const ownerId=a.parcelBooking?booking.senderId:booking.passengerId;if(user.id!==ownerId&&!["ADMIN","SUPPORT"].includes(user.role))throw new ForbiddenError();if(!["ACCEPTED","ARRIVED_AT_PICKUP","PICKUP_CONFIRMED","IN_PROGRESS","ARRIVED_AT_DESTINATION"].includes(a.status))throw new ConflictError("Driver location is visible only during an active, paid assignment.","TRACKING_NOT_AVAILABLE");const loc=await repository.findOwnerLocation({assignment:a,now:clock()});return loc?{latitude:loc.latitude.toString(),longitude:loc.longitude.toString(),accuracyMeters:loc.accuracyMeters?.toString()??null,recordedAt:loc.recordedAt}:null;},
 };
}

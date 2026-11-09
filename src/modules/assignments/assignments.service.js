import { createHash, randomInt } from "node:crypto";
import { createAssignmentsRepository } from "./assignments.repository.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";
export function createAssignmentsService({prismaClient,clock=()=>new Date()}){
 const repository=createAssignmentsRepository(prismaClient);
 return {
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
  async markArrived({assignmentId,userId}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");if(a.driverProfile.userId!==userId)throw new ForbiddenError();const result=await repository.transition({assignmentId,driverUserId:userId,nextStatus:"ARRIVED_AT_PICKUP",now:clock()});if(result?.conflict)throw new ConflictError("Assignment is not in a state that allows arrival at pickup.","ASSIGNMENT_STATE_CONFLICT");if(result?.forbidden)throw new ForbiddenError();if(result?.ineligible)throw new ConflictError(result.ineligible.message,result.ineligible.code);return result;},
  async startTrip({assignmentId,userId}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");if(a.driverProfile.userId!==userId)throw new ForbiddenError();const result=await repository.transition({assignmentId,driverUserId:userId,nextStatus:"IN_PROGRESS",now:clock()});if(result?.conflict)throw new ConflictError("Pickup must be verified before starting the trip.","ASSIGNMENT_STATE_CONFLICT");if(result?.forbidden)throw new ForbiddenError();return result;},
  async markDestination({assignmentId,userId}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");if(a.driverProfile.userId!==userId)throw new ForbiddenError();const result=await repository.transition({assignmentId,driverUserId:userId,nextStatus:"ARRIVED_AT_DESTINATION",now:clock()});if(result?.conflict)throw new ConflictError("Pickup must be verified and the trip started before arriving at destination.","ASSIGNMENT_STATE_CONFLICT");if(result?.forbidden)throw new ForbiddenError();return result;},
  async issueCode({assignmentId,user,action}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");const booking=a.parcelBooking||a.rideBooking;const ownerId=a.parcelBooking?booking.senderId:booking.passengerId;if(user.id!==ownerId)throw new ForbiddenError("Only the booking owner can request a verification code.");const code=String(randomInt(0,1000000)).padStart(6,"0");const result=await repository.issueCode({assignment:a,action,tokenHash:createHash("sha256").update(code).digest("hex"),expiresAt:new Date(clock().getTime()+10*60_000),now:clock()});if(!result)throw new ConflictError("Assignment is no longer active.");if(result.conflict)throw new ConflictError("The driver must arrive at the relevant stop before a code can be issued.","ASSIGNMENT_STATE_CONFLICT");return {assignmentId,action,code,expiresInSeconds:600,note:"Share this one-time code only with your assigned driver."};},
  async verifyCode({assignmentId,userId,action,code}){const result=await repository.verifyCode({assignmentId,driverUserId:userId,action,tokenHash:createHash("sha256").update(code).digest("hex"),now:clock()});if(!result)throw new NotFoundError("Assignment not found.");if(result.forbidden)throw new ForbiddenError();if(result.ineligible)throw new ConflictError(result.ineligible.message,result.ineligible.code);if(result.invalid)throw new ConflictError("The verification code is invalid or expired.","INVALID_VERIFICATION_CODE");if(result.conflict)throw new ConflictError("Assignment is not in the state required for this verification.","ASSIGNMENT_STATE_CONFLICT");return result;},
  async location({assignmentId,user}){const a=await repository.findAssignment(assignmentId);if(!a)throw new NotFoundError("Assignment not found.");const booking=a.parcelBooking||a.rideBooking;const ownerId=a.parcelBooking?booking.senderId:booking.passengerId;if(user.id!==ownerId&&!["ADMIN","SUPPORT"].includes(user.role))throw new ForbiddenError();if(!["ACCEPTED","ARRIVED_AT_PICKUP","PICKUP_CONFIRMED","IN_PROGRESS","ARRIVED_AT_DESTINATION"].includes(a.status))throw new ConflictError("Driver location is visible only during an active, paid assignment.","TRACKING_NOT_AVAILABLE");const loc=await repository.findOwnerLocation({assignment:a,now:clock()});return loc?{latitude:loc.latitude.toString(),longitude:loc.longitude.toString(),accuracyMeters:loc.accuracyMeters?.toString()??null,recordedAt:loc.recordedAt}:null;},
 };
}

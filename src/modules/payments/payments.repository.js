import { prisma } from "../../db/prisma.js";
export function createPaymentsRepository(prismaClient = prisma) {
 return {
  findBooking({bookingType,bookingId,userId}) { return bookingType === "PARCEL" ? prismaClient.parcelBooking.findFirst({where:{id:bookingId,senderId:userId},include:{assignments:{where:{status:"AWAITING_PAYMENT"},take:1}}}) : prismaClient.rideBooking.findFirst({where:{id:bookingId,passengerId:userId},include:{assignments:{where:{status:"AWAITING_PAYMENT"},take:1}}}); },
  createAttempt(data) { return prismaClient.paymentAttempt.create({data}); },
  settle({reference,amountMinor,currency,providerPayload,providerEventId,eventType,payloadHash}) { return prismaClient.$transaction(async tx => {
   const eventKey={provider_providerEventId:{provider:"PAYSTACK",providerEventId}};
   const prior=await tx.providerWebhookEvent.findUnique({where:eventKey});
   if(prior?.processedAt) return {replay:true,status:"already_processed"};
   if(!prior) await tx.providerWebhookEvent.create({data:{provider:"PAYSTACK",providerEventId,eventType,payloadHash}});
   const attempt=await tx.paymentAttempt.findUnique({where:{providerReference:reference}});
   if(!attempt) throw Object.assign(new Error("Payment reference was not found."),{statusCode:404,code:"PAYMENT_REFERENCE_NOT_FOUND"});
   if(attempt.status==="SUCCEEDED"){await tx.providerWebhookEvent.update({where:eventKey,data:{processedAt:new Date()}});return {replay:true,status:"already_settled"};}
   if(attempt.amountMinor!==BigInt(amountMinor)||attempt.currency!==currency) throw Object.assign(new Error("Verified payment amount does not match expected amount."),{statusCode:409,code:"PAYMENT_AMOUNT_MISMATCH"});
   await tx.paymentAttempt.update({where:{id:attempt.id},data:{status:"SUCCEEDED",verifiedAt:new Date(),providerPayload}});
   if(attempt.parcelBookingId){const b=await tx.parcelBooking.findUnique({where:{id:attempt.parcelBookingId}});if(!b||b.paymentStatus==="SUCCEEDED")throw Object.assign(new Error("Parcel booking already settled or missing."),{statusCode:409,code:"BOOKING_ALREADY_SETTLED"});await tx.parcelBooking.update({where:{id:b.id},data:{paymentStatus:"SUCCEEDED",status:"DRIVER_ASSIGNED",paidAt:new Date()}});await tx.driverAssignment.updateMany({where:{parcelBookingId:b.id,status:"AWAITING_PAYMENT"},data:{status:"ACCEPTED",acceptedAt:new Date()}});await tx.bookingEvent.create({data:{parcelBookingId:b.id,eventType:"PAYMENT_CONFIRMED",fromStatus:"AWAITING_PAYMENT",toStatus:"DRIVER_ASSIGNED",metadata:{reference}}});}
   else if(attempt.rideBookingId){const b=await tx.rideBooking.findUnique({where:{id:attempt.rideBookingId}});if(!b||b.paymentStatus==="SUCCEEDED")throw Object.assign(new Error("Ride booking already settled or missing."),{statusCode:409,code:"BOOKING_ALREADY_SETTLED"});await tx.rideBooking.update({where:{id:b.id},data:{paymentStatus:"SUCCEEDED",status:"DRIVER_ASSIGNED",paidAt:new Date()}});await tx.driverAssignment.updateMany({where:{rideBookingId:b.id,status:"AWAITING_PAYMENT"},data:{status:"ACCEPTED",acceptedAt:new Date()}});await tx.bookingEvent.create({data:{rideBookingId:b.id,eventType:"PAYMENT_CONFIRMED",fromStatus:"AWAITING_PAYMENT",toStatus:"DRIVER_ASSIGNED",metadata:{reference}}});}
   else throw Object.assign(new Error("Payment attempt is not linked to a booking."),{statusCode:409,code:"PAYMENT_BOOKING_MISSING"});
   const accounts=await Promise.all([
    tx.ledgerAccount.upsert({where:{code:"PAYSTACK_CLEARING_NGN"},create:{code:"PAYSTACK_CLEARING_NGN",name:"Paystack clearing",type:"ASSET",currency},update:{}}),
    tx.ledgerAccount.upsert({where:{code:"DRIVER_PAYABLE_NGN"},create:{code:"DRIVER_PAYABLE_NGN",name:"Driver payable",type:"LIABILITY",currency},update:{}}),
    tx.ledgerAccount.upsert({where:{code:"PLATFORM_CONNECTION_REVENUE_NGN"},create:{code:"PLATFORM_CONNECTION_REVENUE_NGN",name:"Platform connection fee revenue",type:"REVENUE",currency},update:{}})
   ]);
   const driver=attempt.driverAllocationMinor??(attempt.amountMinor-(attempt.platformAllocationMinor??0n));const platform=attempt.platformAllocationMinor??(attempt.amountMinor-driver);
   if(driver+platform!==attempt.amountMinor)throw Object.assign(new Error("Ledger allocations do not balance."),{statusCode:409,code:"LEDGER_ALLOCATION_MISMATCH"});
   const journalReference="PAYMENT:"+reference;const posted=await tx.ledgerEntry.findFirst({where:{journalReference},select:{id:true}});
   if(!posted){const common={journalReference,currency,paymentAttemptId:attempt.id,description:"Paystack booking settlement"};await tx.ledgerEntry.createMany({data:[{...common,accountId:accounts[0].id,side:"DEBIT",amountMinor:attempt.amountMinor,parcelBookingId:attempt.parcelBookingId,rideBookingId:attempt.rideBookingId},{...common,accountId:accounts[1].id,side:"CREDIT",amountMinor:driver,parcelBookingId:attempt.parcelBookingId,rideBookingId:attempt.rideBookingId},{...common,accountId:accounts[2].id,side:"CREDIT",amountMinor:platform,parcelBookingId:attempt.parcelBookingId,rideBookingId:attempt.rideBookingId}]});}
   await tx.providerWebhookEvent.update({where:eventKey,data:{processedAt:new Date(),processingError:null}});return {replay:false,status:"settled",reference,journalReference};
  }); }
 };
}

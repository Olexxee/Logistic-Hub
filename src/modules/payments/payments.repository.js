import { prisma } from "../../db/prisma.js";
export function createPaymentsRepository(prismaClient = prisma) {
 return {
  findBooking({bookingType,bookingId,userId}) { return bookingType === "PARCEL" ? prismaClient.parcelBooking.findFirst({where:{id:bookingId,senderId:userId},include:{assignments:{where:{status:"AWAITING_PAYMENT"},take:1,include:{driverProfile:{include:{settlementAccounts:{where:{provider:"PAYSTACK",status:"ACTIVE"},take:1}}}}}}}) : prismaClient.rideBooking.findFirst({where:{id:bookingId,passengerId:userId},include:{assignments:{where:{status:"AWAITING_PAYMENT"},take:1,include:{driverProfile:{include:{settlementAccounts:{where:{provider:"PAYSTACK",status:"ACTIVE"},take:1}}}}}}}); },
  createAttempt(data) { return prismaClient.paymentAttempt.upsert({where:{idempotencyKey:data.idempotencyKey},create:data,update:{}}); },
  findUserEmail(userId) { return prismaClient.user.findUnique({where:{id:userId},select:{email:true}}); },
  saveAuthorization({id,authorizationUrl,accessCode}) { return prismaClient.paymentAttempt.update({where:{id},data:{providerPayload:{authorizationUrl,accessCode}}}); },
  updateRefundFromWebhook({ providerReference, status, providerResponse }) {
   return prismaClient.$transaction(async tx => {
    const refund = await tx.refundRequest.findUnique({ where: { providerReference }, include: { paymentAttempt: true } });
    if (!refund || refund.status === status) return { count: 0 };
    const allowed = status === "PROCESSED" ? ["PROCESSING", "FAILED"] : ["PROCESSING"];
    if (!allowed.includes(refund.status)) return { count: 0 };
    const updated = await tx.refundRequest.updateMany({
     where: { id: refund.id, status: { in: allowed } },
     data: { status, providerResponse: { ...(refund.providerResponse ?? {}), ...providerResponse }, processedAt: new Date() },
    });
    if (updated.count !== 1) return { count: 0 };
    await tx.operationalAuditEvent.create({ data: {
     actorUserId: null, entityType: "REFUND_REQUEST", entityId: refund.id,
     action: status === "PROCESSED" ? "REFUND_PROVIDER_CONFIRMED" : "REFUND_PROVIDER_FAILED",
     before: { status: refund.status }, after: { status, providerReference },
     metadata: { actorType: "SYSTEM", systemSource: "PAYSTACK_REFUND_WEBHOOK", providerEvent: providerResponse?.event ?? null },
    } });
    if (status === "PROCESSED") {
     const total = await tx.refundRequest.aggregate({
      where: { paymentAttemptId: refund.paymentAttemptId, status: "PROCESSED" },
      _sum: { amountMinor: true },
     });
     const fullyRefunded = (total._sum.amountMinor ?? 0n) >= refund.paymentAttempt.amountMinor;
     if (fullyRefunded) {
      await tx.paymentAttempt.update({ where: { id: refund.paymentAttemptId }, data: { status: "REVERSED" } });
      if (refund.parcelBookingId) {
       const booking = await tx.parcelBooking.findUnique({ where: { id: refund.parcelBookingId } });
       if (booking?.paymentStatus === "SUCCEEDED") {
        await tx.parcelBooking.update({ where: { id: booking.id }, data: {
         paymentStatus: "REVERSED",
         ...(booking.status === "CANCELLATION_PENDING" ? { status: "CANCELLED", cancelledAt: new Date() } : {}),
        } });
        if (booking.status === "CANCELLATION_PENDING") await tx.bookingEvent.create({ data: {
         parcelBookingId: booking.id, eventType: "CANCELLATION_APPROVED",
         fromStatus: "CANCELLATION_PENDING", toStatus: "CANCELLED",
         metadata: { refundRequestId: refund.id, refundReference: refund.publicReference, providerReference },
        } });
       }
      }
      if (refund.rideBookingId) {
       const booking = await tx.rideBooking.findUnique({ where: { id: refund.rideBookingId } });
       if (booking?.paymentStatus === "SUCCEEDED") {
        await tx.rideBooking.update({ where: { id: booking.id }, data: {
         paymentStatus: "REVERSED",
         ...(booking.status === "CANCELLATION_PENDING" ? { status: "CANCELLED", cancelledAt: new Date() } : {}),
        } });
        if (booking.status === "CANCELLATION_PENDING") await tx.bookingEvent.create({ data: {
         rideBookingId: booking.id, eventType: "CANCELLATION_APPROVED",
         fromStatus: "CANCELLATION_PENDING", toStatus: "CANCELLED",
         metadata: { refundRequestId: refund.id, refundReference: refund.publicReference, providerReference },
        } });
       }
      }
     }
     const journalReference = "REFUND:" + providerReference;
     const posted = await tx.ledgerEntry.findFirst({ where: { journalReference }, select: { id: true } });
     const platformRefund = refund.amountMinor < (refund.paymentAttempt.platformAllocationMinor ?? 0n)
      ? refund.amountMinor : (refund.paymentAttempt.platformAllocationMinor ?? 0n);
     if (!posted && platformRefund > 0n) {
      const accounts = await Promise.all([
       tx.ledgerAccount.upsert({ where: { code: "PLATFORM_CONNECTION_REVENUE_NGN" }, create: { code: "PLATFORM_CONNECTION_REVENUE_NGN", name: "Platform connection fee revenue", type: "REVENUE", currency: refund.currency }, update: {} }),
       tx.ledgerAccount.upsert({ where: { code: "PAYSTACK_CLEARING_NGN" }, create: { code: "PAYSTACK_CLEARING_NGN", name: "Paystack platform clearing", type: "ASSET", currency: refund.currency }, update: {} }),
      ]);
      const common = { journalReference, currency: refund.currency, paymentAttemptId: refund.paymentAttemptId, parcelBookingId: refund.paymentAttempt.parcelBookingId, rideBookingId: refund.paymentAttempt.rideBookingId, description: "Provider-confirmed platform refund reversal" };
      await tx.ledgerEntry.createMany({ data: [
       { ...common, accountId: accounts[0].id, side: "DEBIT", amountMinor: platformRefund },
       { ...common, accountId: accounts[1].id, side: "CREDIT", amountMinor: platformRefund },
      ] });
     }
    }
    return { count: 1 };
   });
  },
  getNotificationContext(reference) { return prismaClient.paymentAttempt.findUnique({where:{providerReference:reference},include:{parcelBooking:{include:{sender:{select:{id:true}},}},rideBooking:{include:{passenger:{select:{id:true}}}}}}); },
  markFailed({reference,providerEventId,eventType,payloadHash,providerPayload}) { return prismaClient.$transaction(async tx=>{
   const eventKey={provider_providerEventId:{provider:"PAYSTACK",providerEventId}};
   const prior=await tx.providerWebhookEvent.findUnique({where:eventKey});
   if(prior?.processedAt)return {replay:true,status:"already_processed"};
   if(!prior)await tx.providerWebhookEvent.create({data:{provider:"PAYSTACK",providerEventId,eventType,payloadHash}});
   const attempt=await tx.paymentAttempt.findUnique({where:{providerReference:reference}});
   if(!attempt)throw Object.assign(new Error("Payment reference was not found."),{statusCode:404,code:"PAYMENT_REFERENCE_NOT_FOUND"});
   if(attempt.status!=="SUCCEEDED") {
    await tx.paymentAttempt.update({where:{id:attempt.id},data:{status:"FAILED",failedAt:new Date(),providerPayload}});
    if(attempt.parcelBookingId)await tx.parcelBooking.updateMany({where:{id:attempt.parcelBookingId,paymentStatus:{not:"SUCCEEDED"}},data:{paymentStatus:"FAILED"}});
    if(attempt.rideBookingId)await tx.rideBooking.updateMany({where:{id:attempt.rideBookingId,paymentStatus:{not:"SUCCEEDED"}},data:{paymentStatus:"FAILED"}});
   }
   await tx.providerWebhookEvent.update({where:eventKey,data:{processedAt:new Date()}});
   return {replay:false,status:"failed",reference};
  }); },
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
   let settlementContext;
   if(attempt.parcelBookingId){const b=await tx.parcelBooking.findUnique({where:{id:attempt.parcelBookingId}});if(!b||b.paymentStatus==="SUCCEEDED")throw Object.assign(new Error("Parcel booking already settled or missing."),{statusCode:409,code:"BOOKING_ALREADY_SETTLED"});settlementContext={userId:b.senderId,bookingId:b.id,bookingType:"PARCEL",publicReference:b.publicReference};await tx.parcelBooking.update({where:{id:b.id},data:{paymentStatus:"SUCCEEDED",status:"DRIVER_ASSIGNED",paidAt:new Date()}});await tx.driverAssignment.updateMany({where:{parcelBookingId:b.id,status:"AWAITING_PAYMENT"},data:{status:"ACCEPTED",acceptedAt:new Date()}});await tx.deliveryLeg.updateMany({where:{parcelBookingId:b.id,status:"AWAITING_PAYMENT"},data:{status:"ASSIGNED",assignedAt:new Date()}});await tx.bookingEvent.create({data:{parcelBookingId:b.id,eventType:"PAYMENT_CONFIRMED",fromStatus:"AWAITING_PAYMENT",toStatus:"DRIVER_ASSIGNED",metadata:{reference}}});}
   else if(attempt.rideBookingId){const b=await tx.rideBooking.findUnique({where:{id:attempt.rideBookingId}});if(!b||b.paymentStatus==="SUCCEEDED")throw Object.assign(new Error("Ride booking already settled or missing."),{statusCode:409,code:"BOOKING_ALREADY_SETTLED"});settlementContext={userId:b.passengerId,bookingId:b.id,bookingType:"RIDE",publicReference:b.publicReference};await tx.rideBooking.update({where:{id:b.id},data:{paymentStatus:"SUCCEEDED",status:"DRIVER_ASSIGNED",paidAt:new Date()}});await tx.driverAssignment.updateMany({where:{rideBookingId:b.id,status:"AWAITING_PAYMENT"},data:{status:"ACCEPTED",acceptedAt:new Date()}});await tx.bookingEvent.create({data:{rideBookingId:b.id,eventType:"PAYMENT_CONFIRMED",fromStatus:"AWAITING_PAYMENT",toStatus:"DRIVER_ASSIGNED",metadata:{reference}}});}
   else throw Object.assign(new Error("Payment attempt is not linked to a booking."),{statusCode:409,code:"PAYMENT_BOOKING_MISSING"});
   const platform=attempt.platformAllocationMinor??0n;
   if(platform<0n||platform>attempt.amountMinor)throw Object.assign(new Error("Platform allocation is outside the captured amount."),{statusCode:409,code:"LEDGER_ALLOCATION_MISMATCH"});
   const accounts=await Promise.all([
    tx.ledgerAccount.upsert({where:{code:"PAYSTACK_CLEARING_NGN"},create:{code:"PAYSTACK_CLEARING_NGN",name:"Paystack platform clearing",type:"ASSET",currency},update:{}}),
    tx.ledgerAccount.upsert({where:{code:"PLATFORM_CONNECTION_REVENUE_NGN"},create:{code:"PLATFORM_CONNECTION_REVENUE_NGN",name:"Platform connection fee revenue",type:"REVENUE",currency},update:{}})
   ]);
   const journalReference="PAYMENT:"+reference;const posted=await tx.ledgerEntry.findFirst({where:{journalReference},select:{id:true}});
   if(!posted&&platform>0n){const common={journalReference,currency,paymentAttemptId:attempt.id,description:"Fixed platform connection fee from Paystack split"};await tx.ledgerEntry.createMany({data:[
    {...common,accountId:accounts[0].id,side:"DEBIT",amountMinor:platform,parcelBookingId:attempt.parcelBookingId,rideBookingId:attempt.rideBookingId},
    {...common,accountId:accounts[1].id,side:"CREDIT",amountMinor:platform,parcelBookingId:attempt.parcelBookingId,rideBookingId:attempt.rideBookingId}
   ]});}
   await tx.providerWebhookEvent.update({where:eventKey,data:{processedAt:new Date(),processingError:null}});return {replay:false,status:"settled",reference,journalReference,...settlementContext};
  }); }
 };
}

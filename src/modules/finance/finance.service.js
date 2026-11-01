import {randomBytes} from "node:crypto";
import {env} from "../../config/env.js";
import {createFinanceRepository} from "./finance.repository.js";
import {createPaymentsRepository} from "../payments/payments.repository.js";
import {ConflictError,NotFoundError,ServiceUnavailableError,ForbiddenError} from "../../shared/http/app-error.js";
export function createFinanceService({prismaClient,secretKey=env.PAYSTACK_SECRET_KEY,refundsEnabled=env.REFUNDS_ENABLED,fetchImpl=fetch,clock=()=>new Date()}){const repo=createFinanceRepository(prismaClient);const paymentsRepo=createPaymentsRepository(prismaClient);return{
 async requestRefund({userId,input,idempotencyKey}) {
  if(!idempotencyKey)throw new ConflictError("Idempotency-Key is required.","IDEMPOTENCY_KEY_REQUIRED");
  const result=await repo.createRefundRequest({userId,...input,idempotencyKey,publicReference:"REF-"+randomBytes(5).toString("hex").toUpperCase()});
  if(result.notFound)throw new NotFoundError("Payment attempt not found.");
  if(result.forbidden)throw new ForbiddenError("You do not own the booking for this payment.");
  if(result.conflict)throw new ConflictError("Refund amount exceeds the refundable balance, the idempotency key conflicts, or the payment is not settled.","REFUND_NOT_ELIGIBLE");
  return {...result.refund,amountMinor:result.refund.amountMinor.toString(),replay:result.replay};
 },
 async reviewRefund({id,user,decision,reviewNote}) {
  if(user?.role!=="ADMIN")throw new ForbiddenError("Only an administrator can approve or reject refund requests.");
  const refund=await repo.findRefund(id);
  if(!refund)throw new NotFoundError("Refund request not found.");
  if(!["PENDING_REVIEW","FAILED"].includes(refund.status))throw new ConflictError("Refund request is not awaiting review.","REFUND_STATE_CONFLICT");
  if(decision==="REJECT"){
   const rejected=await repo.reviewRefund({id,reviewerId:user.id,decision, note:reviewNote});
   if(!rejected)throw new ConflictError("Refund request changed before it could be rejected.","REFUND_STATE_CONFLICT");
   return {...rejected,amountMinor:rejected.amountMinor.toString()};
  }
  if(!refundsEnabled)throw new ServiceUnavailableError("Provider refund processing is disabled. Requests can be reviewed, but no money will move until REFUNDS_ENABLED is explicitly approved.","REFUNDS_DISABLED");
  if(!secretKey)throw new ServiceUnavailableError("Paystack is not configured.","PAYSTACK_NOT_CONFIGURED");
  if(refund.paymentAttempt.status!=="SUCCEEDED"||!refund.paymentAttempt.providerReference)throw new ConflictError("The captured payment cannot currently be refunded.","REFUND_PAYMENT_NOT_REFUNDABLE");
  const reviewed=await repo.reviewRefund({id,reviewerId:user.id,decision, note:reviewNote});
  if(!reviewed)throw new ConflictError("Refund request changed before it could be approved.","REFUND_STATE_CONFLICT");
  let response;
  try {
   response=await fetchImpl("https://api.paystack.co/refund",{
    method:"POST",headers:{Authorization:"Bearer "+secretKey,"Content-Type":"application/json"},
    body:JSON.stringify({transaction:refund.paymentAttempt.providerReference,amount:Number(refund.amountMinor),customer_note:refund.reason,merchant_note:("Logistic Hub refund "+refund.publicReference+" | "+reviewNote).slice(0,500)}),
   });
  } catch {
   await repo.markRefundSubmissionUnknown({id,actorUserId:user.id});
   throw new ServiceUnavailableError("Paystack's response could not be confirmed. The refund remains locked for reconciliation; do not submit it again.","REFUND_SUBMISSION_OUTCOME_UNKNOWN");
  }
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body?.status||!body?.data){
   await repo.markRefundFailed({id,actorUserId:user.id,providerResponse:{code:"PAYSTACK_REFUND_REQUEST_FAILED",message:typeof body?.message==="string"?body.message.slice(0,300):"Provider rejected the refund request.",providerStatusCode:response.status}});
   throw new ServiceUnavailableError("Paystack rejected the refund request. It is marked failed and requires review before another attempt.","PAYSTACK_REFUND_FAILED");
  }
  const providerReference=body.data.id!=null?String(body.data.id):(body.data.reference!=null?String(body.data.reference):null);
  if(!providerReference){
   await repo.markRefundSubmissionUnknown({id,actorUserId:user.id});
   throw new ServiceUnavailableError("Paystack accepted the request without a refund identifier. Reconciliation is required; do not resubmit.","REFUND_SUBMISSION_OUTCOME_UNKNOWN");
  }
  const saved=await repo.recordRefundProviderResult({id,actorUserId:user.id,providerReference,providerResponse:{status:body.data.status??"pending",id:body.data.id??null,amount:body.data.amount??null,currency:body.data.currency??refund.currency}});
  return {...saved,amountMinor:saved.amountMinor.toString()};
 },
 async reconcileRefund({id,user}) {
  if(user?.role!=="ADMIN")throw new ForbiddenError("Only an administrator can reconcile a provider refund.");
  const refund=await repo.findRefund(id);
  if(!refund)throw new NotFoundError("Refund request not found.");
  if(refund.status!=="PROCESSING")throw new ConflictError("Only a refund in PROCESSING state can be reconciled.","REFUND_STATE_CONFLICT");
  if(!secretKey)throw new ServiceUnavailableError("Paystack is not configured.","PAYSTACK_NOT_CONFIGURED");
  let providerReference=refund.providerReference;
  if(!providerReference){
   const transactionReference=refund.paymentAttempt?.providerReference;
   if(!transactionReference)throw new ConflictError("The captured payment has no provider reference.","PAYMENT_REFERENCE_MISSING");
   let listResponse;
   try {
    listResponse=await fetchImpl("https://api.paystack.co/refund?transaction="+encodeURIComponent(transactionReference)+"&perPage=100",{headers:{Authorization:"Bearer "+secretKey}});
   } catch {
    throw new ServiceUnavailableError("Paystack refund lookup failed. The local refund remains locked for reconciliation.","REFUND_RECONCILIATION_UNAVAILABLE");
   }
   const listBody=await listResponse.json().catch(()=>null);
   if(!listResponse.ok||!listBody?.status||!Array.isArray(listBody.data))throw new ServiceUnavailableError("Paystack did not return a usable refund list.","REFUND_RECONCILIATION_UNAVAILABLE");
   const marker="Logistic Hub refund "+refund.publicReference;
   const matches=listBody.data.filter(item=>typeof item.merchant_note==="string"&&item.merchant_note.startsWith(marker));
   if(matches.length===0)return {id:refund.id,status:refund.status,reconciliation:"NO_PROVIDER_MATCH",message:"No matching Paystack refund was found. The request remains locked; do not resubmit it automatically."};
   if(matches.length!==1)throw new ConflictError("More than one Paystack refund matches this local request. Manual finance investigation is required.","REFUND_RECONCILIATION_AMBIGUOUS");
   if(matches[0].id==null)throw new ServiceUnavailableError("The matching Paystack refund has no provider identifier.","REFUND_RECONCILIATION_UNAVAILABLE");
   providerReference=String(matches[0].id);
  }
  let detailResponse;
  try {
   detailResponse=await fetchImpl("https://api.paystack.co/refund/"+encodeURIComponent(providerReference),{headers:{Authorization:"Bearer "+secretKey}});
  } catch {
   throw new ServiceUnavailableError("Paystack refund detail lookup failed. The local refund remains unchanged.","REFUND_RECONCILIATION_UNAVAILABLE");
  }
  const detailBody=await detailResponse.json().catch(()=>null);
  if(!detailResponse.ok||!detailBody?.status||!detailBody?.data)throw new ServiceUnavailableError("Paystack did not return refund details.","REFUND_RECONCILIATION_UNAVAILABLE");
  const providerStatus=String(detailBody.data.status??"").toLowerCase();
  const providerResponse={status:providerStatus||"unknown",id:detailBody.data.id??providerReference,amount:detailBody.data.amount??null,currency:detailBody.data.currency??refund.currency};
  await repo.recordRefundProviderResult({id,actorUserId:user.id,providerReference,providerResponse});
  if(providerStatus==="processed"||providerStatus==="failed"){
   await paymentsRepo.updateRefundFromWebhook({providerReference,status:providerStatus==="processed"?"PROCESSED":"FAILED",providerResponse:{...providerResponse,event:"refund.reconciliation"}});
  } else if(!["pending","processing","needs-attention"].includes(providerStatus)){
   throw new ConflictError("Paystack returned an unrecognized refund status: "+providerStatus+".","REFUND_PROVIDER_STATUS_UNKNOWN");
  }
  const refreshed=await repo.findRefund(id);
  return {...refreshed,amountMinor:refreshed.amountMinor.toString(),reconciliation:"MATCHED"};
 },
 async listRefunds({status}) {
  const rows=await repo.listRefunds({status});
  return rows.map(refund=>({...refund,amountMinor:refund.amountMinor.toString()}));
 },
 async confirmPayout({id,providerReference,user}){if(!["ADMIN","SUPPORT"].includes(user.role))throw new ForbiddenError();const payout=await repo.confirmPayout({id,providerReference,actorUserId:user.id});if(!payout)throw new NotFoundError("Driver settlement record not found.");return payout;},
 listPayouts({status}){return repo.listPayouts({status});},
 reconciliation(){return repo.reconciliation();},
 async processRefundWebhook({payload}){const status=payload.event==="refund.processed"?"PROCESSED":payload.event==="refund.failed"?"FAILED":null;if(!status)return{ignored:true};const ref=String(payload.data?.id??payload.data?.reference??"");if(!ref)return{ignored:true};const result=await repo.updateRefundFromWebhook({providerReference:ref,status,providerResponse:{event:payload.event,id:ref}});return{updatedCount:result.count};}
};}

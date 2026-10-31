import {randomBytes} from "node:crypto";
import {createSupportRepository} from "./support.repository.js";
import {ForbiddenError,NotFoundError} from "../../shared/http/app-error.js";
import {writeOperationalAuditEvent} from "../../shared/audit/operational-audit.js";
export function createSupportService({prismaClient,clock=()=>new Date()}){const repo=createSupportRepository(prismaClient);return{
 async create({user,input}){return repo.createTicket({publicReference:"SUP-"+randomBytes(5).toString("hex").toUpperCase(),customerId:user.id,bookingType:input.bookingType,bookingId:input.bookingId,category:input.category,subject:input.subject,description:input.description});},
 async listMine({userId,cursor,limit=20}){const rows=await repo.listMine({customerId:userId,cursor,limit});return{data:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]?.id??null:null};},
 async listAdmin({status,cursor,limit=50}){const rows=await repo.listAdmin({status,cursor,limit});return{data:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]?.id??null:null};},
 async update({id,user,input}){if(!["ADMIN","SUPPORT"].includes(user.role))throw new ForbiddenError();return prismaClient.$transaction(async tx=>{const txRepo=createSupportRepository(tx);const existing=await txRepo.findById(id);if(!existing)throw new NotFoundError("Support ticket not found.");const updated=await txRepo.updateTicket({id,data:{...input,assignedToUserId:input.assignedToUserId===undefined?existing.assignedToUserId:input.assignedToUserId},now:clock()});await writeOperationalAuditEvent(tx,{actorUserId:user.id,entityType:"SUPPORT_TICKET",entityId:id,action:"SUPPORT_TICKET_UPDATED",reason:input.resolution??null,before:{status:existing.status,priority:existing.priority,assignedToUserId:existing.assignedToUserId},after:{status:updated.status,priority:updated.priority,assignedToUserId:updated.assignedToUserId}});return updated;});}
};}

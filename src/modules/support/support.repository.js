import {prisma} from "../../db/prisma.js";
export function createSupportRepository(prismaClient=prisma){return{
 createTicket(data){return prismaClient.supportTicket.create({data});},
 listMine({customerId,cursor,limit}){return prismaClient.supportTicket.findMany({where:{customerId},orderBy:{createdAt:"desc"},take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});},
 listAdmin({status,cursor,limit}){return prismaClient.supportTicket.findMany({where:status?{status}: {},orderBy:[{priority:"desc"},{createdAt:"asc"}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});},
 findById(id){return prismaClient.supportTicket.findUnique({where:{id}});},
 updateTicket({id,data,now}){return prismaClient.supportTicket.update({where:{id},data:{...data,...(["RESOLVED","CLOSED"].includes(data.status)?{resolvedAt:now}:{})}});}
};}

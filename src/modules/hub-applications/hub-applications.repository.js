export function createHubApplicationsRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    transaction(work) { return prismaClient.$transaction(work, { isolationLevel: "Serializable" }); },
    findPartner(partnerId, tx = prismaClient) {
      return tx.transportPartner.findUnique({ where: { id: partnerId } });
    },
    findMembership(partnerId, userId, tx = prismaClient) {
      return tx.transportPartnerMember.findUnique({ where: { partnerId_userId: { partnerId, userId } } });
    },
    findOwnerMembership(partnerId, userId, tx = prismaClient) {
      return tx.transportPartnerMember.findUnique({ where: { partnerId_userId: { partnerId, userId } } });
    },
    findZone(serviceZoneId, tx = prismaClient) {
      return tx.serviceZone.findUnique({ where: { id: serviceZoneId }, include: { state: { include: { country: true } } } });
    },
    findPendingDuplicate(partnerId, serviceZoneId, name, tx = prismaClient) {
      return tx.hubApplication.findFirst({
        where: { partnerId, serviceZoneId, name: { equals: name, mode: "insensitive" }, status: "PENDING" },
      });
    },
    createApplication(data, tx = prismaClient) { return tx.hubApplication.create({ data }); },
    listForApplicant(userId) {
      return prismaClient.hubApplication.findMany({
        where: { applicantUserId: userId },
        include: { partner: { select: { id: true, displayName: true } }, serviceZone: { select: { id: true, name: true } }, hubPoint: { select: { id: true, name: true, status: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },
    listAdmin(tx = prismaClient) {
      return tx.hubApplication.findMany({
        include: {
          partner: { select: { id: true, displayName: true, legalName: true, status: true, verificationStatus: true } },
          applicant: { select: { id: true, fullName: true, email: true, phone: true } },
          serviceZone: { select: { id: true, name: true, state: { select: { name: true, code: true } } } },
          hubPoint: { select: { id: true, name: true, status: true } },
          reviewer: { select: { id: true, fullName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },
    findApplication(applicationId, tx = prismaClient) {
      return tx.hubApplication.findUnique({
        where: { id: applicationId },
        include: { partner: true, serviceZone: { include: { state: { include: { country: true } } } }, applicant: true },
      });
    },
    updateApplication(applicationId, data, tx = prismaClient) {
      return tx.hubApplication.update({ where: { id: applicationId }, data });
    },
    createHubPoint(data, tx = prismaClient) { return tx.hubPoint.create({ data }); },
    createHubManager(data, tx = prismaClient) {
      return tx.hubPointOperator.upsert({
        where: { hubPointId_userId: { hubPointId: data.hubPointId, userId: data.userId } },
        create: { ...data, role: "MANAGER", isActive: true },
        update: { role: "MANAGER", isActive: true },
      });
    },
    createAudit(data, tx = prismaClient) { return tx.operationalAuditEvent.create({ data }); },
  };
}

export function createCustodyRepository({ prismaClient }) {
  return {
    transaction(work) { return prismaClient.$transaction(work); },
    findHub(hubPointId, tx = prismaClient) {
      return tx.hubPoint.findUnique({ where: { id: hubPointId }, select: { id: true, status: true, name: true } });
    },
    findUser(userId, tx = prismaClient) {
      return tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, role: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } });
    },
    findHubOperator(hubPointId, userId, tx = prismaClient) {
      return tx.hubPointOperator.findUnique({ where: { hubPointId_userId: { hubPointId, userId } } });
    },
    findHubOperatorsForUser(userId, tx = prismaClient) {
      return tx.hubPointOperator.findMany({ where: { userId, isActive: true, hubPoint: { status: "ACTIVE" } }, select: { hubPointId: true } });
    },
    findHubOperatorById(hubPointId, operatorId, tx = prismaClient) {
      return tx.hubPointOperator.findFirst({ where: { id: operatorId, hubPointId } });
    },
    upsertHubOperator(data, tx = prismaClient) {
      return tx.hubPointOperator.upsert({
        where: { hubPointId_userId: { hubPointId: data.hubPointId, userId: data.userId } },
        create: data,
        update: { role: data.role, isActive: true },
      });
    },
    updateHubOperator(id, isActive, tx = prismaClient) {
      return tx.hubPointOperator.update({ where: { id }, data: { isActive } });
    },
    countActiveHubMemberships(userId, tx = prismaClient) {
      return tx.hubPointOperator.count({ where: { userId, isActive: true } });
    },
    setUserRole(userId, role, tx = prismaClient) {
      return tx.user.update({ where: { id: userId }, data: { role } });
    },
    setUserPhoneVerification(userId, phoneVerifiedAt, tx = prismaClient) {
      return tx.user.update({ where: { id: userId }, data: { phoneVerifiedAt } });
    },
    findBookingLeg(deliveryLegId, tx = prismaClient) {
      return tx.deliveryLeg.findUnique({
        where: { id: deliveryLegId },
        include: {
          parcelBooking: { select: { id: true, senderId: true, paymentStatus: true, status: true, recipientName: true, recipientPhone: true } },
          assignments: { where: { status: { notIn: ["CANCELLED", "FAILED", "COMPLETED"] } }, include: { driverProfile: { select: { id: true, userId: true } } } },
          partnerAssignments: { where: { status: { notIn: ["CANCELLED", "FAILED"] } }, select: { partnerId: true, status: true } },
        },
      });
    },
    findHubForParty(id, tx = prismaClient) {
      return tx.hubPoint.findUnique({ where: { id }, select: { id: true, status: true } });
    },
    findDriverForParty(id, tx = prismaClient) {
      return tx.driverProfile.findUnique({ where: { id }, select: { id: true, userId: true, verificationStatus: true } });
    },
    findPartnerForParty(id, tx = prismaClient) {
      return tx.transportPartner.findUnique({ where: { id }, select: { id: true, status: true, verificationStatus: true } });
    },
    findPartnerMembership(partnerId, userId, tx = prismaClient) {
      return tx.transportPartnerMember.findUnique({ where: { partnerId_userId: { partnerId, userId } } });
    },
    findHandover(id, tx = prismaClient) {
      return tx.custodyHandover.findUnique({ where: { id }, include: { deliveryLeg: true, parcelBooking: true } });
    },
    findPendingHandover(deliveryLegId, tx = prismaClient) {
      return tx.custodyHandover.findFirst({ where: { deliveryLegId, status: "PENDING_CONFIRMATION" } });
    },
    createHandover(data, tx = prismaClient) {
      return tx.custodyHandover.create({ data });
    },
    updateHandover(id, data, tx = prismaClient) {
      return tx.custodyHandover.update({ where: { id }, data });
    },
    createOperationalCase(data, tx = prismaClient) {
      return tx.operationalCase.create({ data });
    },
    createAudit(data, tx = prismaClient) {
      return tx.operationalAuditEvent.create({ data });
    },
    listHubHandovers(hubPointIds, { direction = "incoming", status, cursor, limit = 25 } = {}, tx = prismaClient) {
      const where = direction === "incoming"
        ? { toPartyType: "HUB", toPartyId: { in: hubPointIds }, ...(status ? { status } : {}) }
        : { fromPartyType: "HUB", fromPartyId: { in: hubPointIds }, ...(status ? { status } : {}) };
      return tx.custodyHandover.findMany({
        where,
        orderBy: [{ initiatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, deliveryLegId: true, hubPointId: true,
          fromPartyType: true, fromPartyId: true, toPartyType: true, toPartyId: true,
          status: true, conditionAtRelease: true, conditionAtReceipt: true, evidence: true,
          expiresAt: true, initiatedAt: true, confirmedAt: true, rejectedAt: true, rejectionReason: true,
          parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true, handlingInstructions: true, status: true } },
          deliveryLeg: {
            select: {
              id: true, sequence: true, type: true, status: true,
              originServiceZone: { select: { name: true, state: { select: { name: true } } } },
              destinationServiceZone: { select: { name: true, state: { select: { name: true } } } },
              originHubPoint: { select: { id: true, name: true, address: true } },
              destinationHubPoint: { select: { id: true, name: true, address: true } },
            },
          },
          hubPoint: { select: { id: true, name: true, address: true } },
        },
      });
    },
    findDispatchableLegs(hubPointIds, { cursor, limit = 25 } = {}, tx = prismaClient) {
      return tx.deliveryLeg.findMany({
        where: {
          originHubPointId: { in: hubPointIds },
          status: { in: ["ASSIGNED", "READY_FOR_ASSIGNMENT", "PICKUP_VERIFICATION_PENDING"] },
          parcelBooking: { is: { paymentStatus: "SUCCEEDED" } },
          OR: [
            { assignments: { some: { status: "ARRIVED_AT_PICKUP" } } },
            { partnerAssignments: { some: { status: "ACCEPTED" } } },
          ],
        },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, sequence: true, type: true, status: true,
          originHubPointId: true, destinationHubPointId: true,
          parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true, handlingInstructions: true } },
          originServiceZone: { select: { name: true, state: { select: { name: true } } } },
          destinationServiceZone: { select: { name: true, state: { select: { name: true } } } },
          originHubPoint: { select: { id: true, name: true, address: true } },
          destinationHubPoint: { select: { id: true, name: true, address: true } },
          assignments: {
            where: { status: "ARRIVED_AT_PICKUP" },
            select: { id: true, driverProfileId: true, status: true, driverProfile: { select: { user: { select: { fullName: true } } } } },
          },
          partnerAssignments: {
            where: { status: "ACCEPTED" },
            select: { id: true, partnerId: true, status: true, partner: { select: { displayName: true } } },
          },
        },
      });
    },
    listMyHandovers(userId, hubIds, partnerIds, driverIds, tx = prismaClient) {
      const parties = [
        { fromPartyType: "SENDER", fromPartyId: userId }, { toPartyType: "SENDER", toPartyId: userId },
        { fromPartyType: "RECIPIENT", fromPartyId: userId }, { toPartyType: "RECIPIENT", toPartyId: userId },
      ];
      for (const id of hubIds) parties.push({ OR: [{ fromPartyType: "HUB", fromPartyId: id }, { toPartyType: "HUB", toPartyId: id }] });
      for (const id of partnerIds) parties.push({ OR: [{ fromPartyType: "TRANSPORT_PARTNER", fromPartyId: id }, { toPartyType: "TRANSPORT_PARTNER", toPartyId: id }] });
      for (const id of driverIds) parties.push({ OR: [{ fromPartyType: "DRIVER", fromPartyId: id }, { toPartyType: "DRIVER", toPartyId: id }] });
      return tx.custodyHandover.findMany({
        where: { OR: parties },
        include: { deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } } },
        orderBy: [{ initiatedAt: "desc" }, { id: "desc" }],
        take: 100,
      });
    },
  };
}

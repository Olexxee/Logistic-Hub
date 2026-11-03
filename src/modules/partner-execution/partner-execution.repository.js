export function createPartnerExecutionRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    findAssignmentByIdempotencyKey(idempotencyKey, tx = prismaClient) {
      return tx.partnerDeliveryAssignment.findUnique({ where: { idempotencyKey } });
    },
    findLegForAssignment(deliveryLegId, tx = prismaClient) {
      return tx.deliveryLeg.findUnique({
        where: { id: deliveryLegId },
        include: { parcelBooking: { select: { id: true, paymentStatus: true, status: true } } },
      });
    },
    findPartner(partnerId, tx = prismaClient) {
      return tx.transportPartner.findUnique({ where: { id: partnerId } });
    },
    findActiveAgreement(agreementId, tx = prismaClient) {
      return tx.partnerAgreement.findUnique({ where: { id: agreementId }, include: { partner: true } });
    },
    createAssignment(data, tx = prismaClient) {
      return tx.partnerDeliveryAssignment.create({ data });
    },
    findAssignment(id, tx = prismaClient) {
      return tx.partnerDeliveryAssignment.findUnique({
        where: { id },
        include: { partner: true, deliveryLeg: true },
      });
    },
    listAssignments(partnerIds, { skip = 0, take = 20 } = {}, tx = prismaClient) {
      const where = { partnerId: { in: partnerIds } };
      return Promise.all([
        tx.partnerDeliveryAssignment.findMany({
          where,
          skip,
          take,
          select: {
            id: true,
            status: true,
            agreedTransportChargeMinor: true,
            currency: true,
            assignedAt: true,
            acceptedAt: true,
            startedAt: true,
            completedAt: true,
            failureReason: true,
            partner: { select: { id: true, displayName: true } },
            deliveryLeg: {
              select: {
                id: true,
                sequence: true,
                type: true,
                status: true,
                parcelBookingId: true,
                parcelBooking: { select: {
                  id: true, publicReference: true, parcelCategory: true, parcelSize: true,
                  handlingInstructions: true, status: true,
                } },
                originServiceZone: { select: { id: true, name: true, state: { select: { code: true, name: true } } } },
                destinationServiceZone: { select: { id: true, name: true, state: { select: { code: true, name: true } } } },
                originHubPoint: { select: { id: true, name: true, address: true } },
                destinationHubPoint: { select: { id: true, name: true, address: true } },
              },
            },
          },
          orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        }),
        tx.partnerDeliveryAssignment.count({ where }),
      ]).then(([items, total]) => ({ items, total }));
    },
    listPartnerMembers(partnerId, { where = {}, skip = 0, take = 20 } = {}, tx = prismaClient) {
      const scopedWhere = { partnerId, ...where };
      return Promise.all([
        tx.transportPartnerMember.findMany({
          where: scopedWhere,
          skip,
          take,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: {
            id: true, partnerId: true, userId: true, role: true, isActive: true,
            createdAt: true, updatedAt: true,
            user: { select: {
              id: true, fullName: true, email: true, phone: true,
              role: true, status: true, emailVerifiedAt: true,
            } },
          },
        }),
        tx.transportPartnerMember.count({ where: scopedWhere }),
      ]).then(([items, total]) => ({ items, total }));
    },
    findMembership(partnerId, userId, tx = prismaClient) {
      return tx.transportPartnerMember.findUnique({ where: { partnerId_userId: { partnerId, userId } } });
    },
    findMembershipsForUser(userId, tx = prismaClient) {
      return tx.transportPartnerMember.findMany({
        where: { userId, isActive: true, partner: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
        select: { partnerId: true },
      });
    },
  };
}

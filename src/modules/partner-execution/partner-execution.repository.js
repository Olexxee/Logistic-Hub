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
    listAssignments(partnerIds, tx = prismaClient) {
      return tx.partnerDeliveryAssignment.findMany({
        where: { partnerId: { in: partnerIds } },
        include: { partner: { select: { id: true, displayName: true } }, deliveryLeg: {
          select: { id: true, sequence: true, type: true, status: true, parcelBookingId: true },
        } },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      });
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

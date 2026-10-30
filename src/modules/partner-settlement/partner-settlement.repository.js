export function createPartnerSettlementRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    transaction(callback) {
      return prismaClient.$transaction(callback);
    },
    listPayables(where, take = 100) {
      return prismaClient.partnerPayable.findMany({
        where,
        include: {
          partner: { select: { id: true, displayName: true } },
          assignment: { select: { id: true, status: true, agreedTransportChargeMinor: true } },
          batchItem: { include: { batch: { select: { id: true, reference: true, status: true } } } },
        },
        orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
        take,
      });
    },
    listBatches(where, take = 100) {
      return prismaClient.partnerSettlementBatch.findMany({
        where,
        include: {
          partner: { select: { id: true, displayName: true } },
          items: { include: { payable: { select: { id: true, status: true, amountMinor: true } } } },
          reconciliations: { orderBy: { createdAt: "desc" } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    },
  };
}

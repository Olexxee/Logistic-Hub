export function createPartnerPricingAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    listPartners: ({ where, skip, take }) => prismaClient.transportPartner.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { _count: { select: { agreements: true, members: true, hubPoints: true } } },
    }),
    countPartners: where => prismaClient.transportPartner.count({ where }),
    findPartnerAdmin: id => prismaClient.transportPartner.findUnique({
      where: { id },
      include: { _count: { select: { agreements: true, members: true, hubPoints: true, deliveryAssignments: true } } },
    }),
    createPartner: data => prismaClient.transportPartner.create({ data }),
    findPartner: id => prismaClient.transportPartner.findUnique({ where: { id } }),
    updatePartner: (id, data) => prismaClient.transportPartner.update({ where: { id }, data }),
    createAgreement: data => prismaClient.partnerAgreement.create({ data }),
    transaction: callback => prismaClient.$transaction(callback),
  };
}

export function createPartnerPricingAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    listPartners: () => prismaClient.transportPartner.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: { _count: { select: { agreements: true } } },
    }),
    createPartner: data => prismaClient.transportPartner.create({ data }),
    findPartner: id => prismaClient.transportPartner.findUnique({ where: { id } }),
    updatePartner: (id, data) => prismaClient.transportPartner.update({ where: { id }, data }),
    createAgreement: data => prismaClient.partnerAgreement.create({ data }),
    transaction: callback => prismaClient.$transaction(callback),
  };
}

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

    listAgreements: ({ partnerId, where, skip, take }) => prismaClient.partnerAgreement.findMany({
      where: { partnerId, ...where },
      skip, take,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: {
        _count: { select: { rateCards: true, deliveryAssignments: true, payables: true } },
      },
    }),
    countAgreements: ({ partnerId, where }) => prismaClient.partnerAgreement.count({ where: { partnerId, ...where } }),
    findAgreementAdmin: id => prismaClient.partnerAgreement.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, displayName: true, status: true, verificationStatus: true } },
        rateCards: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], include: { _count: { select: { rates: true } } } },
        _count: { select: { deliveryAssignments: true, payables: true, quotes: true } },
      },
    }),
    listRateCards: ({ agreementId, where, skip, take }) => prismaClient.partnerRateCard.findMany({
      where: { agreementId, ...where },
      skip, take,
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { rates: true } } },
    }),
    countRateCards: ({ agreementId, where }) => prismaClient.partnerRateCard.count({ where: { agreementId, ...where } }),
    findRateCardAdmin: id => prismaClient.partnerRateCard.findUnique({
      where: { id },
      include: {
        agreement: { include: { partner: { select: { id: true, displayName: true, status: true, verificationStatus: true } } } },
        rates: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            originServiceZone: { select: { id: true, code: true, name: true, isActive: true, state: { select: { id: true, name: true } } } },
            destinationServiceZone: { select: { id: true, code: true, name: true, isActive: true, state: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
  };
}

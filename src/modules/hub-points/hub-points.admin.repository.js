export function createHubPointsAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    list() {
      return prismaClient.hubPoint.findMany({
        orderBy: [{ createdAt: "desc" }],
        include: { serviceZone: { include: { lga: true, state: { include: { country: true } } } } },
      });
    },
    findById(id) {
      return prismaClient.hubPoint.findUnique({
        where: { id },
        include: { serviceZone: { include: { lga: true, state: { include: { country: true } }, availability: true } } },
      });
    },
    create(data) {
      return prismaClient.hubPoint.create({ data });
    },
    update(id, data) {
      return prismaClient.hubPoint.update({ where: { id }, data });
    },
  };
}

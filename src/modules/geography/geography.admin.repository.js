export function createGeographyAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    listCountries: () => prismaClient.country.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { states: true } } } }),
    findCountry: (id) => prismaClient.country.findUnique({ where: { id } }),
    createCountry: (data) => prismaClient.country.create({ data }),
    updateCountry: (id, data) => prismaClient.country.update({ where: { id }, data }),
    listStates: (where = {}) => prismaClient.state.findMany({ where, orderBy: { name: "asc" }, include: { country: true, _count: { select: { lgas: true, zones: true } } } }),
    findState: (id) => prismaClient.state.findUnique({ where: { id }, include: { country: true } }),
    createState: (data) => prismaClient.state.create({ data }),
    updateState: (id, data) => prismaClient.state.update({ where: { id }, data }),
    listLgas: (where = {}) => prismaClient.lGA.findMany({ where, orderBy: { name: "asc" }, include: { state: { include: { country: true } }, _count: { select: { zones: true } } } }),
    findLga: (id) => prismaClient.lGA.findUnique({ where: { id }, include: { state: { include: { country: true } }, _count: { select: { zones: true } } } }),
    createLga: (data) => prismaClient.lGA.create({ data }),
    updateLga: (id, data) => prismaClient.lGA.update({ where: { id }, data }),
    deleteLga: (id) => prismaClient.lGA.delete({ where: { id } }),
    countActiveZonesForState: (stateId) => prismaClient.serviceZone.count({ where: { stateId, isActive: true } }),
  };
}
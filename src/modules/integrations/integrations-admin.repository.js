export function createIntegrationsAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    transaction(work) { return prismaClient.$transaction(work); },
    listClients({ status, search, skip, take }) {
      const where = {
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { code: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
        ] } : {}),
      };
      return prismaClient.integrationClient.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take,
        select: {
          id: true, code: true, name: true, status: true, scopes: true, metadata: true, createdAt: true, updatedAt: true,
          _count: { select: { credentials: true, billingAgreements: true } },
        },
      });
    },
    countClients({ status, search }) {
      const where = {
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { code: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
        ] } : {}),
      };
      return prismaClient.integrationClient.count({ where });
    },
    findClient(clientId, tx = prismaClient) {
      return tx.integrationClient.findUnique({ where: { id: clientId } });
    },
    createClient(data, tx) { return tx.integrationClient.create({ data }); },
    updateClient(clientId, data, tx) { return tx.integrationClient.update({ where: { id: clientId }, data }); },
    createCredential(data, tx) { return tx.integrationCredential.create({ data }); },
    findCredential(credentialId, tx) { return tx.integrationCredential.findUnique({ where: { id: credentialId } }); },
    revokeCredential(credentialId, now, tx) {
      return tx.integrationCredential.update({
        where: { id: credentialId },
        data: { status: "REVOKED", revokedAt: now },
        select: { id: true, clientId: true, keyId: true, label: true, status: true, revokedAt: true },
      });
    },
    maxAgreementVersion(clientId, reference, tx) {
      return tx.integrationBillingAgreement.aggregate({
        where: { clientId, reference }, _max: { version: true },
      });
    },
    createAgreement(data, tx) { return tx.integrationBillingAgreement.create({ data }); },
    writeAudit(tx, event) { return tx.operationalAuditEvent.create({ data: event }); },
  };
}

import { createAuditRepository } from "./audit.repository.js";
export function createAuditService({ prismaClient }) {
  const repository = createAuditRepository({ prismaClient });
  return { list: input => repository.list(input) };
}

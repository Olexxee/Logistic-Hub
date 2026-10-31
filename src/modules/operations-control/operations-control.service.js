import { createOperationsControlRepository } from "./operations-control.repository.js";

export function createOperationsControlService({ prismaClient, clock = () => new Date() }) {
  const repository = createOperationsControlRepository({ prismaClient });

  return {
    async getOverview() {
      return {
        generatedAt: clock().toISOString(),
        metrics: await repository.getOverview(),
      };
    },
  };
}

import { createCancellationsRepository } from "./cancellations.repository.js";
import { ConflictError, NotFoundError } from "../../shared/http/app-error.js";


export function createCancellationsService({
  prismaClient,
  clock = () => new Date(),
}) {
  const repo = createCancellationsRepository(prismaClient);
  return {
    async cancel(input) {
      const result = await repo.cancel({ ...input, now: clock() });
      if (!result)
        throw new NotFoundError(
          "Booking not found or not owned by this account.",
        );
      if (result.conflict)
        throw new ConflictError(
          "This booking can no longer be cancelled.",
          "BOOKING_NOT_CANCELLABLE",
        );
      return result;
    },
  };
}

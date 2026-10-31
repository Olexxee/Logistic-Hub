import { createOperationalCasesRepository } from "./operational-cases.repository.js";

const transitions = {
  OPEN: new Set(["TRIAGED"]),
  TRIAGED: new Set(["IN_PROGRESS"]),
  IN_PROGRESS: new Set(["RESOLVED"]),
  RESOLVED: new Set(["CLOSED"]),
  CLOSED: new Set(),
};
async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

export function createOperationalCasesService({ prismaClient, clock = () => new Date() }) {
  const repo = createOperationalCasesRepository({ prismaClient });
  return {
    async list(input) {
      const rows = await repo.list(input);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return { items, nextCursor: hasMore ? items.at(-1).id : null };
    },
    async update({ caseId, actorUserId, status, priority, assignedToUserId, resolution }) {
      return serializableTransaction(prismaClient, async tx => {
        const current = await repo.findById(caseId, tx);
        if (!current) return { notFound: true };
        if (assignedToUserId !== undefined && assignedToUserId !== null) {
          const assignee = await repo.findAssignee(assignedToUserId, tx);
          if (!assignee || assignee.status !== "ACTIVE" || !assignee.emailVerifiedAt || !["ADMIN", "SUPPORT"].includes(assignee.role)) {
            return { blocker: "ASSIGNEE_INELIGIBLE" };
          }
        }
        if (status && status !== current.status && !transitions[current.status]?.has(status)) {
          throw conflict("INVALID_CASE_TRANSITION", `Operational case cannot move from ${current.status} to ${status}.`);
        }
        if (status === "RESOLVED" && !resolution?.trim() && !current.resolution) {
          throw conflict("CASE_RESOLUTION_REQUIRED", "A resolution summary is required before resolving an operational case.");
        }
        if (status === "CLOSED" && current.status !== "RESOLVED") {
          throw conflict("CASE_NOT_RESOLVED", "Only resolved operational cases can be closed.");
        }
        const data = {
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(assignedToUserId !== undefined ? { assignedToUserId } : {}),
          ...(resolution !== undefined ? { resolution } : {}),
          ...(status === "RESOLVED" ? { resolvedAt: clock() } : {}),
          ...(status === "CLOSED" ? { closedAt: clock() } : {}),
        };
        const updated = await repo.update(caseId, data, tx);
        await repo.audit({
          actorUserId, entityType: "OPERATIONAL_CASE", entityId: caseId,
          action: "OPERATIONAL_CASE_UPDATED",
          before: { status: current.status, priority: current.priority, assignedToUserId: current.assignedToUserId, resolution: current.resolution },
          after: { status: updated.status, priority: updated.priority, assignedToUserId: updated.assignedToUserId, resolution: updated.resolution },
        }, tx);
        return { operationalCase: updated };
      });
    },
  };
}

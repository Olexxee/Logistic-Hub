import { createHubOperatorsAdminRepository } from "./hub-operators.admin.repository.js";

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

export function createHubOperatorsAdminService({ prismaClient }) {
  const repository = createHubOperatorsAdminRepository({ prismaClient });

  async function assertManagerRemains(tx, hubPointId, excludedMemberId) {
    const count = await tx.hubPointOperator.count({
      where: {
        hubPointId, isActive: true, role: "MANAGER",
        ...(excludedMemberId ? { id: { not: excludedMemberId } } : {}),
        user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
      },
    });
    if (!count) throw conflict("LAST_ACTIVE_HUB_MANAGER", "An active hub must retain at least one active, email-verified manager.");
  }

  return {
    async list({ hubPointId, page, limit, search, role, isActive }) {
      const hub = await repository.findHub(hubPointId);
      if (!hub) return { notFound: true };
      const where = {
        ...(role ? { role } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(search ? { user: { OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ] } } : {}),
      };
      const [items, total] = await Promise.all([
        repository.listMembers(hubPointId, { where, skip: (page - 1) * limit, take: limit }),
        repository.countMembers(hubPointId, where),
      ]);
      return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    },

    async add({ hubPointId, userId, role, canDispatch, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const hub = await repository.findHub(hubPointId, tx);
        if (!hub) return { notFound: true };
        if (hub.status === "CLOSED") return { blocker: "HUB_CLOSED" };
        const user = await repository.findUser(userId, tx);
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        const existing = await repository.findMembership(hubPointId, userId, tx);
        if (existing?.isActive && existing.role === role && existing.canDispatch === canDispatch) {
          return { member: existing, unchanged: true };
        }
        if (hub.status === "ACTIVE" && existing?.role === "MANAGER" &&
          (!existing.isActive || role !== "MANAGER")) {
          await assertManagerRemains(tx, hubPointId, existing.id);
        }
        if (hub.status === "ACTIVE" && role !== "MANAGER") {
          await assertManagerRemains(tx, hubPointId, existing?.id);
        }
        const member = await repository.upsertMember({ hubPointId, userId, role, canDispatch }, tx);
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: member.id,
          action: !existing ? "HUB_OPERATOR_ADDED" : !existing.isActive ? "HUB_OPERATOR_REACTIVATED" : "HUB_OPERATOR_UPDATED",
          reason,
          before: existing ? { hubPointId, userId, role: existing.role, isActive: existing.isActive, canDispatch: existing.canDispatch } : null,
          after: { hubPointId, userId, role: member.role, isActive: member.isActive, canDispatch: member.canDispatch },
        } });
        return { member };
      });
    },

    async update({ hubPointId, memberId, isActive, role, canDispatch, reason, actorUserId }) {
      return serializableTransaction(prismaClient, async tx => {
        const hub = await repository.findHub(hubPointId, tx);
        if (!hub) return { notFound: true };
        if (hub.status === "CLOSED") return { blocker: "HUB_CLOSED" };
        const existing = await repository.findMember(hubPointId, memberId, tx);
        if (!existing) return { memberNotFound: true };
        const next = {
          isActive: isActive ?? existing.isActive,
          role: role ?? existing.role,
          canDispatch: canDispatch ?? existing.canDispatch,
        };
        if (existing.isActive === next.isActive && existing.role === next.role && existing.canDispatch === next.canDispatch) {
          return { member: existing, unchanged: true };
        }
        if (next.isActive && !existing.isActive) {
          const user = await repository.findUser(existing.userId, tx);
          if (user?.status !== "ACTIVE" || !user.emailVerifiedAt) return { blocker: "USER_NOT_ACTIVE" };
        }
        const removesEligibleManager = existing.isActive && existing.role === "MANAGER" &&
          (!next.isActive || next.role !== "MANAGER");
        if (hub.status === "ACTIVE" && removesEligibleManager) await assertManagerRemains(tx, hubPointId, existing.id);
        const member = await repository.updateMember(memberId, next, tx);
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "HUB_POINT_OPERATOR", entityId: member.id,
          action: existing.role !== member.role ? "HUB_OPERATOR_ROLE_UPDATED" :
            existing.canDispatch !== member.canDispatch ? "HUB_OPERATOR_DISPATCH_PERMISSION_UPDATED" :
            member.isActive ? "HUB_OPERATOR_ACTIVATED" : "HUB_OPERATOR_SUSPENDED",
          reason,
          before: { hubPointId, userId: existing.userId, role: existing.role, isActive: existing.isActive, canDispatch: existing.canDispatch },
          after: { hubPointId, userId: member.userId, role: member.role, isActive: member.isActive, canDispatch: member.canDispatch },
        } });
        return { member };
      });
    },
  };
}

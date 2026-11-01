import { createAdminUsersRepository } from "./admin-users.repository.js";

function userView(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, role: user.role, status: user.status };
}

export function createAdminUsersService({ prismaClient, clock = () => new Date() }) {
  const repository = createAdminUsersRepository({ prismaClient });

  return {
    async updateStatus({ userId, status, reason, actorUserId }) {
      return repository.transaction(async tx => {
        const user = await repository.findUser(userId, tx);
        if (!user) return { notFound: true };
        if (actorUserId === userId) return { blocker: "SELF_ACCOUNT_MODIFICATION" };
        if (user.role === "ADMIN") return { blocker: "ADMIN_ACCOUNT_PROTECTED" };
        if (user.status === "CLOSED") return { blocker: "ACCOUNT_CLOSED" };
        if (user.status === status) {
          if (status !== "SUSPENDED") return { user: userView(user), replay: true, revokedCount: 0 };
          const revoked = await repository.revokeActiveSessions(userId, clock(), tx);
          if (revoked.count) {
            await repository.createAudit({
              actorUserId, entityType: "USER_ACCOUNT", entityId: userId,
              action: "ADMIN_USER_SUSPENSION_SESSION_CLEANUP",
              reason,
              before: { status: user.status },
              after: { status: user.status, revokedSessionCount: revoked.count },
            }, tx);
          }
          return { user: userView(user), replay: true, revokedCount: revoked.count };
        }
        if (status === "SUSPENDED" && user.status !== "ACTIVE") return { blocker: "ACCOUNT_NOT_SUSPENDABLE" };
        if (status === "ACTIVE" && user.status !== "SUSPENDED") return { blocker: "ACCOUNT_NOT_REACTIVATABLE" };
        if (status === "ACTIVE" && !user.emailVerifiedAt) return { blocker: "EMAIL_VERIFICATION_REQUIRED" };

        const now = clock();
        const updated = await repository.updateUserStatus(userId, status, tx);
        const revoked = status === "SUSPENDED"
          ? await repository.revokeActiveSessions(userId, now, tx)
          : { count: 0 };

        await repository.createAudit({
          actorUserId,
          entityType: "USER_ACCOUNT",
          entityId: userId,
          action: status === "SUSPENDED" ? "ADMIN_USER_SUSPENDED" : "ADMIN_USER_REACTIVATED",
          reason,
          before: { status: user.status },
          after: { status: updated.status, revokedSessionCount: revoked.count },
        }, tx);

        return {
          user: { id: updated.id, fullName: updated.fullName, email: updated.email, role: updated.role, status: updated.status },
          replay: false,
          revokedCount: revoked.count,
        };
      });
    },

    async revokeAllSessions({ userId, reason, actorUserId }) {
      return repository.transaction(async tx => {
        const user = await repository.findUser(userId, tx);
        if (!user) return { notFound: true };
        if (actorUserId === userId) return { blocker: "SELF_SESSION_REVOCATION" };
        if (user.role === "ADMIN") return { blocker: "ADMIN_ACCOUNT_PROTECTED" };

        const now = clock();
        const activeSessionCount = await repository.countActiveSessions(userId, now, tx);
        const result = await repository.revokeActiveSessions(userId, now, tx);
        await repository.createAudit({
          actorUserId,
          entityType: "USER_AUTH_SESSIONS",
          entityId: userId,
          action: "ADMIN_USER_SESSIONS_REVOKED",
          reason,
          before: { activeSessionCount },
          after: { revokedSessionCount: result.count },
        }, tx);
        return { revokedCount: result.count };
      });
    },
  };
}

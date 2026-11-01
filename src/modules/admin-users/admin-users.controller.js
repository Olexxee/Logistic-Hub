import { createAdminUsersService } from "./admin-users.service.js";

export function createAdminUsersController({ prismaClient, clock }) {
  const service = createAdminUsersService({ prismaClient, clock });

  return {
    updateStatus: async (req, res) => {
      const result = await service.updateStatus({
        userId: req.params.userId,
        ...req.body,
        actorUserId: req.user.id,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found." } });
      if (result.blocker) {
        const messages = {
          SELF_ACCOUNT_MODIFICATION: "Administrators cannot suspend or reactivate their own account.",
          ADMIN_ACCOUNT_PROTECTED: "Administrator accounts cannot be modified through this endpoint.",
          ACCOUNT_CLOSED: "Closed accounts cannot be reactivated or suspended.",
          ACCOUNT_NOT_SUSPENDABLE: "Only active accounts can be suspended.",
          ACCOUNT_NOT_REACTIVATABLE: "Only suspended accounts can be reactivated.",
          EMAIL_VERIFICATION_REQUIRED: "The user must verify their email before reactivation.",
        };
        return res.status(409).json({ success: false, error: { code: result.blocker, message: messages[result.blocker] } });
      }
      return res.status(200).json({ success: true, data: result });
    },

    revokeAllSessions: async (req, res) => {
      const result = await service.revokeAllSessions({
        userId: req.params.userId,
        ...req.body,
        actorUserId: req.user.id,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found." } });
      if (result.blocker) {
        const messages = {
          SELF_SESSION_REVOCATION: "Use the self-service session revocation endpoint for your own account.",
          ADMIN_ACCOUNT_PROTECTED: "Administrator sessions cannot be revoked through this endpoint.",
        };
        return res.status(409).json({ success: false, error: { code: result.blocker, message: messages[result.blocker] } });
      }
      return res.status(200).json({ success: true, data: result });
    },
  };
}

const WORKSPACE_BY_ROLE = Object.freeze({
  CUSTOMER: { key: "CUSTOMER", landingPath: "/" },
  DRIVER: { key: "DRIVER", landingPath: "/driver" },
  PARTNER_OPERATOR: { key: "PARTNER", landingPath: "/partner" },
  HUB_OPERATOR: { key: "HUB", landingPath: "/hub" },
  SUPPORT: { key: "SUPPORT", landingPath: "/support" },
  ADMIN: { key: "ADMIN", landingPath: "/admin" },
});

function resultFor(role, status, reasonCode = null, profileStatus = null) {
  const workspace = WORKSPACE_BY_ROLE[role];
  if (!workspace) {
    return {
      key: null,
      status: "BLOCKED",
      reasonCode: "UNSUPPORTED_PRIMARY_ROLE",
      landingPath: null,
    };
  }
  return {
    key: workspace.key,
    status,
    reasonCode,
    landingPath: workspace.landingPath,
    ...(profileStatus ? { profileStatus } : {}),
  };
}

export function createWorkspaceResolver({ prismaClient }) {
  if (!prismaClient) throw new TypeError("prismaClient is required");

  return {
    async resolve(user) {
      if (!user?.id || !user.role) {
        return {
          key: null,
          status: "BLOCKED",
          reasonCode: "IDENTITY_UNAVAILABLE",
          landingPath: null,
        };
      }

      if (user.status && user.status !== "ACTIVE") {
        return resultFor(user.role, "BLOCKED", "ACCOUNT_NOT_ACTIVE");
      }

      switch (user.role) {
        case "CUSTOMER":
        case "SUPPORT":
        case "ADMIN":
          return resultFor(user.role, "READY");

        case "DRIVER": {
          const profile = await prismaClient.driverProfile.findUnique({
            where: { userId: user.id },
            select: { verificationStatus: true, suspendedAt: true },
          });
          if (!profile) return resultFor(user.role, "BLOCKED", "DRIVER_PROFILE_REQUIRED", "MISSING");
          if (profile.suspendedAt) {
            return resultFor(user.role, "RESTRICTED", "DRIVER_PROFILE_SUSPENDED", profile.verificationStatus);
          }
          if (profile.verificationStatus !== "VERIFIED") {
            return resultFor(user.role, "RESTRICTED", "DRIVER_VERIFICATION_INCOMPLETE", profile.verificationStatus);
          }
          return resultFor(user.role, "READY", null, profile.verificationStatus);
        }

        case "PARTNER_OPERATOR": {
          const memberships = await prismaClient.transportPartnerMember.findMany({
            where: { userId: user.id, isActive: true },
            select: {
              partner: { select: { status: true, verificationStatus: true } },
            },
          });
          if (!memberships.length) {
            return resultFor(user.role, "BLOCKED", "PARTNER_MEMBERSHIP_REQUIRED");
          }
          const eligible = memberships.some(({ partner }) =>
            partner?.status === "ACTIVE" && partner?.verificationStatus === "VERIFIED");
          if (eligible) return resultFor(user.role, "READY");
          const hasPendingPartner = memberships.some(({ partner }) =>
            partner?.status === "PENDING" || partner?.verificationStatus === "PENDING" ||
            partner?.verificationStatus === "NOT_SUBMITTED");
          return resultFor(
            user.role,
            hasPendingPartner ? "RESTRICTED" : "BLOCKED",
            hasPendingPartner ? "PARTNER_APPROVAL_PENDING" : "PARTNER_NOT_OPERATIONAL",
          );
        }

        case "HUB_OPERATOR": {
          const memberships = await prismaClient.hubPointOperator.findMany({
            where: { userId: user.id, isActive: true },
            select: {
              hubPoint: { select: { status: true, operatorVerificationStatus: true } },
            },
          });
          if (!memberships.length) {
            return resultFor(user.role, "BLOCKED", "HUB_MEMBERSHIP_REQUIRED");
          }
          const eligible = memberships.some(({ hubPoint }) =>
            hubPoint?.status === "ACTIVE" && hubPoint?.operatorVerificationStatus === "VERIFIED");
          if (eligible) return resultFor(user.role, "READY");
          const hasPendingHub = memberships.some(({ hubPoint }) =>
            hubPoint?.status === "PENDING" || hubPoint?.operatorVerificationStatus === "PENDING" ||
            hubPoint?.operatorVerificationStatus === "NOT_SUBMITTED");
          return resultFor(
            user.role,
            hasPendingHub ? "RESTRICTED" : "BLOCKED",
            hasPendingHub ? "HUB_APPROVAL_PENDING" : "HUB_NOT_OPERATIONAL",
          );
        }

        default:
          return resultFor(user.role, "BLOCKED", "UNSUPPORTED_PRIMARY_ROLE");
      }
    },
  };
}

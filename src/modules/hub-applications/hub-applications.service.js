import { createHubApplicationsRepository } from "./hub-applications.repository.js";

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}
function forbidden(code, message) {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = code;
  return error;
}

export function createHubApplicationsService({ prismaClient, clock = () => new Date() }) {
  const repo = createHubApplicationsRepository({ prismaClient });

  return {
    async submit(input, applicantUserId) {
      return repo.transaction(async tx => {
        const [partner, membership, user, zone] = await Promise.all([
          repo.findPartner(input.partnerId, tx),
          repo.findMembership(input.partnerId, applicantUserId, tx),
          tx.user.findUnique({ where: { id: applicantUserId }, select: { id: true, status: true, emailVerifiedAt: true } }),
          repo.findZone(input.serviceZoneId, tx),
        ]);
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
          throw forbidden("HUB_APPLICANT_NOT_ELIGIBLE", "An active, email-verified account is required to submit a hub application.");
        }
        if (!membership?.isActive || membership.role !== "OWNER") {
          throw forbidden("PARTNER_OWNER_REQUIRED", "Only an active OWNER member of the transport partner may submit a hub application.");
        }
        if (!partner || partner.status !== "ACTIVE" || partner.verificationStatus !== "VERIFIED") {
          throw conflict("PARTNER_NOT_OPERATIONAL", "The transport partner must be active and verified before applying for a hub.");
        }
        if (!zone || !zone.isActive || !zone.state?.isActive || !zone.state.country?.isActive) {
          throw conflict("SERVICE_ZONE_INACTIVE", "The selected service zone and its parent geography must be active.");
        }
        const duplicate = await repo.findPendingDuplicate(input.partnerId, input.serviceZoneId, input.name, tx);
        if (duplicate) return { application: duplicate, replay: true };
        const application = await repo.createApplication({
          ...input,
          applicantUserId,
          status: "PENDING",
        }, tx);
        await repo.createAudit({
          actorUserId: applicantUserId,
          entityType: "HUB_APPLICATION",
          entityId: application.id,
          action: "HUB_APPLICATION_SUBMITTED",
          after: { partnerId: input.partnerId, serviceZoneId: input.serviceZoneId, name: input.name, status: application.status },
        }, tx);
        return { application, replay: false };
      });
    },

    listMine(userId) { return repo.listForApplicant(userId); },
    listAdmin() { return repo.listAdmin(); },

    async approve(applicationId, reason, reviewerUserId) {
      return repo.transaction(async tx => {
        const application = await repo.findApplication(applicationId, tx);
        if (!application) return { notFound: true };
        if (application.status === "APPROVED" && application.hubPointId) {
          return { application, hubPointId: application.hubPointId, replay: true };
        }
        if (application.status !== "PENDING") return { blocker: "APPLICATION_NOT_PENDING" };
        if (application.partner.status !== "ACTIVE" || application.partner.verificationStatus !== "VERIFIED") {
          return { blocker: "PARTNER_NOT_OPERATIONAL" };
        }
        if (application.applicant.status !== "ACTIVE" || !application.applicant.emailVerifiedAt) {
          return { blocker: "APPLICANT_NOT_ACTIVE" };
        }
        const ownerMembership = await repo.findOwnerMembership(application.partnerId, application.applicantUserId, tx);
        if (!ownerMembership?.isActive || ownerMembership.role !== "OWNER") {
          return { blocker: "PARTNER_OWNER_REQUIRED" };
        }
        if (!application.serviceZone.isActive || !application.serviceZone.state?.isActive || !application.serviceZone.state.country?.isActive) {
          return { blocker: "SERVICE_ZONE_INACTIVE" };
        }
        const now = clock();
        const hubPoint = await repo.createHubPoint({
          partnerId: application.partnerId,
          serviceZoneId: application.serviceZoneId,
          name: application.name,
          address: application.address,
          latitude: application.latitude,
          longitude: application.longitude,
          status: "PENDING",
          operatorName: application.operatorName,
          operatorPhone: application.operatorPhone,
          operatorVerificationStatus: "PENDING",
          openingHours: application.openingHours,
          acceptedParcelTypes: application.acceptedParcelTypes,
          capacityConfig: application.capacityConfig,
        }, tx);
        await repo.createHubManager({ hubPointId: hubPoint.id, userId: application.applicantUserId }, tx);
        const updated = await repo.updateApplication(applicationId, {
          status: "APPROVED", reviewReason: reason, reviewedAt: now, reviewedByUserId: reviewerUserId, hubPointId: hubPoint.id,
        }, tx);
        await repo.createAudit({
          actorUserId: reviewerUserId,
          entityType: "HUB_APPLICATION",
          entityId: applicationId,
          action: "HUB_APPLICATION_APPROVED",
          reason,
          before: { status: application.status },
          after: { status: updated.status, hubPointId: hubPoint.id, partnerId: application.partnerId },
        }, tx);
        await repo.createAudit({
          actorUserId: reviewerUserId,
          entityType: "HUB_POINT",
          entityId: hubPoint.id,
          action: "HUB_POINT_CREATED_FROM_APPLICATION",
          reason,
          after: { partnerId: application.partnerId, serviceZoneId: application.serviceZoneId, status: hubPoint.status },
        }, tx);
        return { application: updated, hubPoint, replay: false };
      });
    },

    async withdraw(applicationId, applicantUserId) {
      return repo.transaction(async tx => {
        const application = await tx.hubApplication.findFirst({
          where: { id: applicationId, applicantUserId },
        });
        if (!application) return { notFound: true };
        if (application.status !== "PENDING") return { blocker: "APPLICATION_NOT_PENDING" };
        const updated = await repo.updateApplication(applicationId, { status: "WITHDRAWN" }, tx);
        await repo.createAudit({
          actorUserId: applicantUserId, entityType: "HUB_APPLICATION", entityId: applicationId,
          action: "HUB_APPLICATION_WITHDRAWN",
          before: { status: application.status }, after: { status: updated.status },
        }, tx);
        return { application: updated };
      });
    },

    async reject(applicationId, reason, reviewerUserId) {
      return repo.transaction(async tx => {
        const application = await repo.findApplication(applicationId, tx);
        if (!application) return { notFound: true };
        if (application.status !== "PENDING") return { blocker: "APPLICATION_NOT_PENDING" };
        const updated = await repo.updateApplication(applicationId, {
          status: "REJECTED", reviewReason: reason, reviewedAt: clock(), reviewedByUserId: reviewerUserId,
        }, tx);
        await repo.createAudit({
          actorUserId: reviewerUserId,
          entityType: "HUB_APPLICATION",
          entityId: applicationId,
          action: "HUB_APPLICATION_REJECTED",
          reason,
          before: { status: application.status },
          after: { status: updated.status, reviewReason: reason },
        }, tx);
        return { application: updated };
      });
    },
  };
}

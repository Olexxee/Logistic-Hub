import { randomBytes, createHash } from "node:crypto";

function httpError(statusCode, code, message) {
  const error = new Error(message); error.statusCode = statusCode; error.code = code; return error;
}
function conflict(message) { throw httpError(409, "PARTNER_ASSIGNMENT_STATE_CONFLICT", message); }
function notFound() { throw httpError(404, "NOT_FOUND", "Partner assignment not found."); }

export function partnerAssignmentTransition(status, action, legStatus) {
  if (action === "ACCEPT") return status === "OFFERED" ? "ACCEPTED" : null;
  if (action === "REJECT") return status === "OFFERED" ? "REJECTED" : null;
  if (action === "START") return status === "ACCEPTED" && legStatus === "READY_FOR_ASSIGNMENT" ? "IN_TRANSIT" : null;
  if (action === "ARRIVE") return status === "IN_TRANSIT" ? "ARRIVED_AT_HUB" : null;
  return null;
}

export function createPartnerExecutionService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    async issueCredential({ partnerId, label, expiresAt, actorUserId }) {
      const partner = await prismaClient.transportPartner.findUnique({ where: { id: partnerId } });
      if (!partner) return null;
      if (partner.status !== "ACTIVE" || partner.verificationStatus !== "VERIFIED") {
        conflict("Only active, verified partners can receive API credentials.");
      }
      const token = `lhp_${randomBytes(32).toString("base64url")}`;
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const credential = await prismaClient.$transaction(async (tx) => {
        const created = await tx.partnerApiCredential.create({
          data: { partnerId, label, tokenHash, expiresAt: expiresAt ?? null },
          select: { id: true, partnerId: true, label: true, expiresAt: true, createdAt: true },
        });
        await tx.operationalAuditEvent.create({
          data: { actorUserId, entityType: "PARTNER_API_CREDENTIAL", entityId: created.id, action: "PARTNER_API_CREDENTIAL_ISSUED", metadata: { partnerId, label, expiresAt: expiresAt?.toISOString() ?? null } },
        });
        return created;
      });
      return { credential, token };
    },
    async revokeCredential({ partnerId, credentialId, actorUserId }) {
      return prismaClient.$transaction(async (tx) => {
        const credential = await tx.partnerApiCredential.findFirst({ where: { id: credentialId, partnerId } });
        if (!credential) return null;
        if (credential.revokedAt) return { id: credential.id, revokedAt: credential.revokedAt, replay: true };
        const now = clock();
        const updated = await tx.partnerApiCredential.updateMany({ where: { id: credential.id, revokedAt: null }, data: { revokedAt: now } });
        if (updated.count !== 1) return { id: credential.id, revokedAt: now, replay: true };
        await tx.operationalAuditEvent.create({ data: { actorUserId, entityType: "PARTNER_API_CREDENTIAL", entityId: credential.id, action: "PARTNER_API_CREDENTIAL_REVOKED", metadata: { partnerId } } });
        return { id: credential.id, revokedAt: now, replay: false };
      });
    },
    async listAssignments({ partnerId }) {
      const items = await prismaClient.partnerAssignment.findMany({
        where: { partnerId, status: { in: ["OFFERED", "ACCEPTED", "IN_TRANSIT", "ARRIVED_AT_HUB"] } },
        include: {
          parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true } },
          deliveryLeg: {
            include: {
              originServiceZone: { select: { name: true } },
              destinationServiceZone: { select: { name: true } },
              originHubPoint: { select: { name: true } },
              destinationHubPoint: { select: { name: true } },
            },
          },
        },
        orderBy: { offeredAt: "desc" },
      });
      return items.map((item) => ({
        id: item.id, status: item.status, currency: item.currency,
        quotedTransportChargeMinor: item.quotedTransportChargeMinor.toString(),
        partnerReference: item.partnerReference,
        offeredAt: item.offeredAt, acceptedAt: item.acceptedAt, startedAt: item.startedAt, arrivedAtHubAt: item.arrivedAtHubAt,
        bookingReference: item.parcelBooking.publicReference,
        parcelCategory: item.parcelBooking.parcelCategory,
        parcelSize: item.parcelBooking.parcelSize,
        leg: {
          id: item.deliveryLeg.id, sequence: item.deliveryLeg.sequence, type: item.deliveryLeg.type,
          originZone: item.deliveryLeg.originServiceZone.name,
          destinationZone: item.deliveryLeg.destinationServiceZone.name,
          originHub: item.deliveryLeg.originHubPoint?.name ?? null,
          destinationHub: item.deliveryLeg.destinationHubPoint?.name ?? null,
        },
      }));
    },
    async transition({ partnerId, assignmentId, action, reason }) {
      return prismaClient.$transaction(async (tx) => {
        const assignment = await tx.partnerAssignment.findFirst({
          where: { id: assignmentId, partnerId },
          include: { deliveryLeg: true, parcelBooking: true },
        });
        if (!assignment) return null;
        const nextStatus = partnerAssignmentTransition(assignment.status, action, assignment.deliveryLeg.status);
        if (!nextStatus) {
          if ((action === "ACCEPT" && assignment.status === "ACCEPTED")
            || (action === "REJECT" && assignment.status === "REJECTED")
            || (action === "START" && assignment.status === "IN_TRANSIT")
            || (action === "ARRIVE" && assignment.status === "ARRIVED_AT_HUB")) {
            return { id: assignment.id, status: assignment.status, replay: true };
          }
          conflict("Partner assignment is not in a state that permits this transition.");
        }
        const now = clock();
        const updated = await tx.partnerAssignment.updateMany({
          where: { id: assignment.id, partnerId, status: assignment.status },
          data: {
            status: nextStatus,
            ...(action === "ACCEPT" ? { acceptedAt: now } : {}),
            ...(action === "REJECT" ? { rejectedAt: now, rejectionReason: reason } : {}),
            ...(action === "START" ? { startedAt: now } : {}),
            ...(action === "ARRIVE" ? { arrivedAtHubAt: now } : {}),
          },
        });
        if (updated.count !== 1) conflict("Partner assignment changed while processing the request.");
        if (action === "START") {
          const legUpdate = await tx.deliveryLeg.updateMany({
            where: { id: assignment.deliveryLegId, status: "READY_FOR_ASSIGNMENT" },
            data: { status: "IN_TRANSIT", startedAt: now },
          });
          if (legUpdate.count !== 1) conflict("The interstate delivery leg is not ready to start.");
        }
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: assignment.parcelBookingId,
            eventType: `PARTNER_ASSIGNMENT_${action}`,
            fromStatus: assignment.status,
            toStatus: nextStatus,
            metadata: { partnerAssignmentId: assignment.id, deliveryLegId: assignment.deliveryLegId, partnerId, ...(reason ? { reason } : {}) },
          },
        });
        return { id: assignment.id, status: nextStatus, replay: false, updatedAt: now };
      });
    },
  };
}

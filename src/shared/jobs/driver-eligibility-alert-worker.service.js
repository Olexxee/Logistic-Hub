import { findParcelExecutionEligibility } from "../../modules/assignments/assignments.repository.js";

const PRE_CUSTODY_STATUSES = ["ACCEPTED", "ARRIVED_AT_PICKUP"];
const ALERTABLE_CODES = new Set([
  "LEG_REQUIRES_PARTNER_EXECUTION",
  "VEHICLE_NOT_BOUND",
  "SERVICE_ZONE_UNAVAILABLE",
  "HUB_UNAVAILABLE",
  "DRIVER_EXECUTION_ELIGIBILITY_CHANGED",
  "VEHICLE_EXECUTION_ELIGIBILITY_CHANGED",
]);

function notificationKey(assignmentId, code) {
  return `drv-eligibility:${assignmentId}:${code}`;
}

function caseReference(assignmentId, code) {
  return `DRV-${assignmentId.slice(-8).toUpperCase()}-${code.slice(-8)}`.slice(0, 64);
}

export function createDriverEligibilityAlertWorker({ prismaClient, clock = () => new Date(), batchSize = 100 }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function alertAssignment(tx, assignment, issue, now) {
    const baseKey = notificationKey(assignment.id, issue.code);
    const existing = await tx.notification.findUnique({ where: { deliveryKey: baseKey }, select: { id: true } });
    if (existing) return false;

    const adminUsers = await tx.user.findMany({
      where: { role: { in: ["ADMIN", "SUPPORT"] }, status: "ACTIVE", emailVerifiedAt: { not: null } },
      select: { id: true },
    });
    const recipients = [...new Set([assignment.driverProfile.userId, ...adminUsers.map(user => user.id)])];
    const operationalCase = await tx.operationalCase.create({
      data: {
        publicReference: caseReference(assignment.id, issue.code),
        type: "ROUTE_DISRUPTION",
        status: "OPEN",
        priority: "HIGH",
        parcelBookingId: assignment.parcelBookingId,
        ...(assignment.deliveryLegId ? { deliveryLegId: assignment.deliveryLegId } : {}),
        reportedByUserId: adminUsers[0]?.id ?? assignment.driverProfile.userId,
        title: "Pre-pickup driver eligibility changed",
        description: `Assignment ${assignment.id} is no longer eligible (${issue.code}). Dispatch review is required before pickup.`,
        evidence: {
          assignmentId: assignment.id,
          reasonCode: issue.code,
          detectedAt: now.toISOString(),
          source: "DRV_05C_C_ALERT_WORKER",
        },
      },
    });

    for (const [index, userId] of recipients.entries()) {
      await tx.notification.create({
        data: {
          userId,
          type: "DRIVER_ASSIGNMENT_ELIGIBILITY_CHANGED",
          title: userId === assignment.driverProfile.userId
            ? "Your parcel assignment needs operational review"
            : "Parcel assignment eligibility alert",
          body: userId === assignment.driverProfile.userId
            ? "An operational requirement changed for an assigned parcel. Please wait for dispatch instructions."
            : `Assignment ${assignment.id} requires review: ${issue.code}.`,
          data: {
            assignmentId: assignment.id,
            operationalCaseId: operationalCase.id,
            reasonCode: issue.code,
            severity: "HIGH",
          },
          deliveryKey: index === 0 ? baseKey : `${baseKey}:${userId}`,
        },
      });
    }

    await tx.operationalAuditEvent.create({
      data: {
        actorUserId: adminUsers[0]?.id ?? assignment.driverProfile.userId,
        entityType: "DRIVER_ASSIGNMENT",
        entityId: assignment.id,
        action: "DRIVER_ASSIGNMENT_ELIGIBILITY_ALERT_CREATED",
        reason: issue.code,
        before: { eligibility: "ELIGIBLE" },
        after: { eligibility: "INELIGIBLE", operationalCaseId: operationalCase.id },
        metadata: { reasonCode: issue.code, source: "DRV_05C_C_ALERT_WORKER" },
      },
    });
    return true;
  }

  return {
    async runOnce() {
      const now = clock();
      const assignments = await prismaClient.driverAssignment.findMany({
        where: {
          parcelBookingId: { not: null },
          status: { in: PRE_CUSTODY_STATUSES },
          executionHoldAt: null,
          parcelBooking: { is: { paymentStatus: "SUCCEEDED" } },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: batchSize,
        include: {
          parcelBooking: true,
          deliveryLeg: true,
          driverProfile: { select: { id: true, userId: true } },
        },
      });

      let alertsCreated = 0;
      for (const candidate of assignments) {
        const created = await prismaClient.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "driver_assignments" WHERE "id" = ${candidate.id} FOR UPDATE`;
          const assignment = await tx.driverAssignment.findUnique({
            where: { id: candidate.id },
            include: {
              parcelBooking: true,
              deliveryLeg: true,
              driverProfile: { select: { id: true, userId: true } },
            },
          });
          if (!assignment || !PRE_CUSTODY_STATUSES.includes(assignment.status)
            || assignment.executionHoldAt
            || !assignment.parcelBookingId
            || assignment.parcelBooking?.paymentStatus !== "SUCCEEDED") return false;
          const issue = await findParcelExecutionEligibility(tx, assignment, now);
          if (!issue || !ALERTABLE_CODES.has(issue.code)) return false;
          return alertAssignment(tx, assignment, issue, now);
        }, { isolationLevel: "Serializable" });
        if (created) alertsCreated += 1;
      }
      return { scanned: assignments.length, alertsCreated };
    },
  };
}

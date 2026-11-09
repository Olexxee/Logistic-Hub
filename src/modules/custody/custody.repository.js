export function createCustodyRepository({ prismaClient }) {
  return {
    transaction(work) { return prismaClient.$transaction(work); },
    findHub(hubPointId, tx = prismaClient) {
      return tx.hubPoint.findUnique({ where: { id: hubPointId }, select: { id: true, status: true, name: true } });
    },
    findUser(userId, tx = prismaClient) {
      return tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, role: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } });
    },
    findHubOperator(hubPointId, userId, tx = prismaClient) {
      return tx.hubPointOperator.findUnique({ where: { hubPointId_userId: { hubPointId, userId } } });
    },
    findHubOperatorsForUser(userId, tx = prismaClient) {
      return tx.hubPointOperator.findMany({
        where: { userId, isActive: true, hubPoint: { status: "ACTIVE" } },
        select: { hubPointId: true, role: true, canDispatch: true },
      });
    },
    findHubOperatorById(hubPointId, operatorId, tx = prismaClient) {
      return tx.hubPointOperator.findFirst({ where: { id: operatorId, hubPointId } });
    },
    listHubOperators(hubPointId, { skip = 0, take = 25, isActive } = {}, tx = prismaClient) {
      const where = { hubPointId, ...(isActive === undefined ? {} : { isActive }) };
      return Promise.all([
        tx.hubPointOperator.findMany({
          where, skip, take,
          include: { user: { select: { id: true, fullName: true, email: true, phone: true, status: true, emailVerifiedAt: true } } },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        }),
        tx.hubPointOperator.count({ where }),
      ]).then(([items, total]) => ({ items, total }));
    },
    upsertHubOperator(data, tx = prismaClient) {
      return tx.hubPointOperator.upsert({
        where: { hubPointId_userId: { hubPointId: data.hubPointId, userId: data.userId } },
        create: data,
        update: { role: data.role, isActive: true, canDispatch: false },
      });
    },
    updateHubOperator(id, isActive, tx = prismaClient) {
      return tx.hubPointOperator.update({
        where: { id },
        data: { isActive, canDispatch: false },
      });
    },
    updateHubOperatorDispatchPermission(id, canDispatch, tx = prismaClient) {
      return tx.hubPointOperator.update({ where: { id }, data: { canDispatch } });
    },
    countActiveHubMemberships(userId, tx = prismaClient) {
      return tx.hubPointOperator.count({ where: { userId, isActive: true } });
    },
    setUserPhoneVerification(userId, phoneVerifiedAt, tx = prismaClient) {
      return tx.user.update({ where: { id: userId }, data: { phoneVerifiedAt } });
    },
    findBookingLeg(deliveryLegId, tx = prismaClient) {
      return tx.deliveryLeg.findUnique({
        where: { id: deliveryLegId },
        include: {
          parcelBooking: { select: { id: true, senderId: true, paymentStatus: true, status: true, recipientName: true, recipientPhone: true, integrationClientId: true } },
          assignments: { where: { status: { notIn: ["CANCELLED", "FAILED", "COMPLETED"] } }, include: { driverProfile: { select: { id: true, userId: true } } } },
          partnerAssignments: { where: { status: { notIn: ["CANCELLED", "FAILED"] } }, select: { partnerId: true, status: true } },
        },
      });
    },
    findHubForParty(id, tx = prismaClient) {
      return tx.hubPoint.findUnique({ where: { id }, select: { id: true, status: true } });
    },
    findDriverForParty(id, tx = prismaClient) {
      return tx.driverProfile.findUnique({ where: { id }, select: { id: true, userId: true, verificationStatus: true } });
    },
    findPartnerForParty(id, tx = prismaClient) {
      return tx.transportPartner.findUnique({ where: { id }, select: { id: true, status: true, verificationStatus: true } });
    },
    findPartnerMembership(partnerId, userId, tx = prismaClient) {
      return tx.transportPartnerMember.findUnique({ where: { partnerId_userId: { partnerId, userId } } });
    },
    lockDriverAssignment(assignmentId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "driver_assignments" WHERE "id" = ${assignmentId} FOR UPDATE`;
    },
    lockHubRecovery(recoveryId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "driver_assignment_hub_recoveries" WHERE "id" = ${recoveryId} FOR UPDATE`;
    },
    findHubRecoveryAssignment(assignmentId, tx = prismaClient) {
      return tx.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          parcelBooking: { select: { id: true, paymentStatus: true, parcelCategory: true, publicReference: true } },
          deliveryLeg: {
            select: {
              id: true, parcelBookingId: true, status: true, type: true,
              originServiceZoneId: true, destinationServiceZoneId: true,
            },
          },
        },
      });
    },
    findActiveDriverRecovery(assignmentId, tx = prismaClient) {
      return tx.driverAssignmentRecovery.findFirst({
        where: { sourceAssignmentId: assignmentId, status: { in: ["PENDING_RELEASE", "PENDING_RECEIPT"] } },
        select: { id: true, status: true },
      });
    },
    findActiveHubRecovery(assignmentId, tx = prismaClient) {
      return tx.driverAssignmentHubRecovery.findFirst({
        where: { sourceAssignmentId: assignmentId, status: "PENDING_RECEIPT" },
        include: { hubIntakeRecord: true },
      });
    },
    createHubRecovery(data, tx = prismaClient) {
      return tx.driverAssignmentHubRecovery.create({ data });
    },
    findHubRecovery(recoveryId, tx = prismaClient) {
      return tx.driverAssignmentHubRecovery.findUnique({
        where: { id: recoveryId },
        include: {
          hubIntakeRecord: true,
          sourceAssignment: {
            select: {
              id: true, status: true, pickupAt: true, executionHoldAt: true,
              executionHoldReason: true, executionHoldOperationalCaseId: true,
              parcelBookingId: true, deliveryLegId: true,
            },
          },
          operationalCase: { select: { id: true, type: true, status: true } },
        },
      });
    },
    listAdminHubRecoveries({ status, hubPointId, cursor, limit = 25 } = {}, tx = prismaClient) {
      return tx.driverAssignmentHubRecovery.findMany({
        where: { ...(status ? { status } : {}), ...(hubPointId ? { hubPointId } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          hubPoint: { select: { id: true, name: true, address: true, status: true } },
          sourceAssignment: {
            select: {
              id: true, status: true, pickupAt: true, failureReason: true,
              driverProfile: { select: { id: true, user: { select: { fullName: true } } } },
            },
          },
          parcelBooking: { select: { id: true, publicReference: true, status: true } },
          deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } },
          operationalCase: { select: { id: true, publicReference: true, status: true, priority: true } },
          hubIntakeRecord: true,
        },
      });
    },
    lockHubIntake(intakeRecordId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "hub_intake_records" WHERE "id" = ${intakeRecordId} FOR UPDATE`;
    },
    findHubIntakeDispositionContext(intakeRecordId, tx = prismaClient) {
      return tx.hubIntakeRecord.findUnique({
        where: { id: intakeRecordId },
        include: {
          parcelBooking: {
            select: {
              id: true, status: true, paymentStatus: true, parcelCategory: true,
              destinationServiceZoneId: true, destinationAddress: true,
              destinationLatitude: true, destinationLongitude: true,
            },
          },
          deliveryLeg: {
            select: {
              id: true, sequence: true, status: true, type: true,
              originServiceZoneId: true, destinationServiceZoneId: true,
            },
          },
          hubPoint: {
            select: {
              id: true, name: true, status: true, serviceZoneId: true,
              latitude: true, longitude: true, acceptedParcelTypes: true,
            },
          },
          driverAssignmentHubRecovery: {
            select: { id: true, status: true, operationalCaseId: true },
          },
          disposition: true,
        },
      });
    },
    findHubIntakeDisposition(intakeRecordId, tx = prismaClient) {
      return tx.hubIntakeDisposition.findUnique({
        where: { intakeRecordId },
        include: { nextDeliveryLeg: true },
      });
    },
    createHubIntakeDisposition(data, tx = prismaClient) {
      return tx.hubIntakeDisposition.create({ data });
    },
    updateHubIntakeDisposition(id, data, tx = prismaClient) {
      return tx.hubIntakeDisposition.update({ where: { id }, data });
    },
    findServiceZoneForContinuation(serviceZoneId, tx = prismaClient) {
      return tx.serviceZone.findUnique({
        where: { id: serviceZoneId },
        select: {
          id: true, isActive: true,
          state: { select: { id: true, isActive: true, country: { select: { isActive: true } } } },
        },
      });
    },
    findHubForContinuation(hubPointId, tx = prismaClient) {
      return tx.hubPoint.findUnique({
        where: { id: hubPointId },
        select: { id: true, name: true, status: true, serviceZoneId: true, latitude: true, longitude: true, acceptedParcelTypes: true },
      });
    },
    findLatestDeliveryLeg(parcelBookingId, tx = prismaClient) {
      return tx.deliveryLeg.findFirst({
        where: { parcelBookingId },
        orderBy: [{ sequence: "desc" }, { id: "desc" }],
        select: { id: true, sequence: true },
      });
    },
    createContinuationLeg(data, tx = prismaClient) {
      return tx.deliveryLeg.create({ data });
    },
    failRecoveredSourceLeg(id, tx = prismaClient) {
      return tx.deliveryLeg.updateMany({
        where: { id, status: { in: ["PLANNED", "READY_FOR_ASSIGNMENT", "ASSIGNED", "PICKUP_VERIFICATION_PENDING", "IN_TRANSIT"] } },
        data: { status: "FAILED", failureReason: "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED" },
      });
    },
    findHubRecoveryForIntake(intakeRecordId, tx = prismaClient) {
      return tx.driverAssignmentHubRecovery.findFirst({
        where: { hubIntakeRecordId: intakeRecordId },
        select: { id: true },
      });
    },
    updateHubRecovery(id, data, tx = prismaClient) {
      return tx.driverAssignmentHubRecovery.update({ where: { id }, data });
    },
    findDriverAssignmentForCustody(assignmentId, tx = prismaClient) {
      return tx.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          driverProfile: { select: { id: true, userId: true } },
          parcelBooking: { select: { id: true, paymentStatus: true } },
          deliveryLeg: { select: { id: true, destinationHubPointId: true } },
        },
      });
    },
    lockDeliveryLeg(deliveryLegId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "delivery_legs" WHERE "id" = ${deliveryLegId} FOR UPDATE`;
    },
    lockDriverAssignmentForLeg(deliveryLegId, driverProfileId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "driver_assignments" WHERE "deliveryLegId" = ${deliveryLegId} AND "driverProfileId" = ${driverProfileId} AND "status" NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') FOR UPDATE`;
    },
    lockHandover(handoverId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "custody_handovers" WHERE "id" = ${handoverId} FOR UPDATE`;
    },
    findHandover(id, tx = prismaClient) {
      return tx.custodyHandover.findUnique({ where: { id }, include: { deliveryLeg: true, parcelBooking: true } });
    },
    findPendingHandover(deliveryLegId, tx = prismaClient) {
      return tx.custodyHandover.findFirst({ where: { deliveryLegId, status: "PENDING_CONFIRMATION" } });
    },
    createHandover(data, tx = prismaClient) {
      return tx.custodyHandover.create({ data });
    },
    updateHandover(id, data, tx = prismaClient) {
      return tx.custodyHandover.update({ where: { id }, data });
    },
    createOperationalCase(data, tx = prismaClient) {
      return tx.operationalCase.create({ data });
    },
    createAudit(data, tx = prismaClient) {
      return tx.operationalAuditEvent.create({ data });
    },
    listAdminCustodyHandovers({ status, hubPointId, q, cursor, limit = 25 } = {}, tx = prismaClient) {
      return tx.custodyHandover.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(hubPointId ? { hubPointId } : {}),
          ...(q ? { parcelBooking: { is: { publicReference: { contains: q, mode: "insensitive" } } } } : {}),
        },
        orderBy: [{ initiatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, deliveryLegId: true, hubPointId: true,
          fromPartyType: true, toPartyType: true, status: true,
          conditionAtRelease: true, conditionAtReceipt: true,
          expiresAt: true, initiatedAt: true, confirmedAt: true, rejectedAt: true, rejectionReason: true,
          parcelBooking: { select: { publicReference: true, status: true } },
          deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } },
          hubPoint: { select: { id: true, name: true } },
        },
      });
    },
    listAdminHubIntakes({ status, hubPointId, q, cursor, limit = 25 } = {}, tx = prismaClient) {
      return tx.hubIntakeRecord.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(hubPointId ? { hubPointId } : {}),
          ...(q ? { parcelBooking: { publicReference: { contains: q, mode: "insensitive" } } } : {}),
        },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, deliveryLegId: true, hubPointId: true,
          status: true, weightGrams: true, lengthMm: true, widthMm: true, heightMm: true,
          volumeCm3: true, conditionAtReceipt: true, receivedAt: true, releasedAt: true,
          parcelBooking: { select: { publicReference: true, status: true, parcelCategory: true, parcelSize: true } },
          deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } },
          hubPoint: { select: { id: true, name: true } },
        },
      });
    },
    listHubHandovers(hubPointIds, { direction = "incoming", status, cursor, limit = 25 } = {}, tx = prismaClient) {
      const where = direction === "incoming"
        ? { toPartyType: "HUB", toPartyId: { in: hubPointIds }, ...(status ? { status } : {}) }
        : { fromPartyType: "HUB", fromPartyId: { in: hubPointIds }, ...(status ? { status } : {}) };
      return tx.custodyHandover.findMany({
        where,
        orderBy: [{ initiatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, deliveryLegId: true, hubPointId: true,
          fromPartyType: true, fromPartyId: true, toPartyType: true, toPartyId: true,
          status: true, conditionAtRelease: true, conditionAtReceipt: true, evidence: true,
          expiresAt: true, initiatedAt: true, confirmedAt: true, rejectedAt: true, rejectionReason: true,
          parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true, handlingInstructions: true, status: true } },
          deliveryLeg: {
            select: {
              id: true, sequence: true, type: true, status: true,
              originServiceZone: { select: { name: true, state: { select: { name: true } } } },
              destinationServiceZone: { select: { name: true, state: { select: { name: true } } } },
              originHubPoint: { select: { id: true, name: true, address: true } },
              destinationHubPoint: { select: { id: true, name: true, address: true } },
            },
          },
          hubPoint: { select: { id: true, name: true, address: true } },
        },
      });
    },
    lockHubCapacity(hubPointId, tx = prismaClient) {
      return tx.$queryRaw`SELECT "id" FROM "hub_points" WHERE "id" = ${hubPointId} FOR UPDATE`;
    },
    findHubIntakeConfig(hubPointId, tx = prismaClient) {
      return tx.hubPoint.findUnique({
        where: { id: hubPointId },
        select: { id: true, status: true, serviceZoneId: true, acceptedParcelTypes: true, capacityConfig: true },
      });
    },
    countReceivedHubIntakes(hubPointId, tx = prismaClient) {
      return tx.hubIntakeRecord.count({ where: { hubPointId, status: "RECEIVED" } });
    },
    aggregateReceivedHubIntakes(hubPointId, tx = prismaClient) {
      return tx.hubIntakeRecord.aggregate({
        where: { hubPointId, status: "RECEIVED" },
        _sum: { weightGrams: true, volumeCm3: true },
      });
    },
    createHubIntakeRecord(data, tx = prismaClient) {
      return tx.hubIntakeRecord.create({ data });
    },
    findActiveHubOperationalCase({ deliveryLegId, hubPointId, type }, tx = prismaClient) {
      return tx.operationalCase.findFirst({
        where: {
          deliveryLegId,
          hubPointId,
          type,
          status: { in: ["OPEN", "TRIAGED", "IN_PROGRESS"] },
        },
        select: { id: true, publicReference: true, type: true, status: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    },
    findBlockingHubOperationalCase(deliveryLegId, tx = prismaClient) {
      return tx.operationalCase.findFirst({
        where: {
          deliveryLegId,
          status: { in: ["OPEN", "TRIAGED", "IN_PROGRESS"] },
          type: { in: ["FAILED_HANDOVER", "DAMAGED_PARCEL", "MISSING_PARCEL", "FAILED_DELIVERY", "ROUTE_DISRUPTION"] },
        },
        select: { id: true, type: true, status: true },
      });
    },
    findAnyReceivedHubIntake(parcelBookingId, tx = prismaClient) {
      return tx.hubIntakeRecord.findFirst({ where: { parcelBookingId, status: "RECEIVED" } });
    },
    findReceivedHubIntake(parcelBookingId, hubPointId, tx = prismaClient) {
      return tx.hubIntakeRecord.findFirst({
        where: { parcelBookingId, hubPointId, status: "RECEIVED" },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      });
    },
    updateHubIntakeRecord(id, data, tx = prismaClient) {
      return tx.hubIntakeRecord.update({ where: { id }, data });
    },
    listHubIntakes(hubPointIds, { status = "RECEIVED", cursor, limit = 25 } = {}, tx = prismaClient) {
      return tx.hubIntakeRecord.findMany({
        where: { hubPointId: { in: hubPointIds }, ...(status ? { status } : {}) },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, deliveryLegId: true, hubPointId: true,
          status: true, weightGrams: true, lengthMm: true, widthMm: true, heightMm: true,
          volumeCm3: true, conditionAtReceipt: true, evidence: true, receivedAt: true, releasedAt: true,
          parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true, handlingInstructions: true } },
          deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } },
          hubPoint: { select: { id: true, name: true, address: true } },
        },
      });
    },
    findDispatchableLegs(hubPointIds, { cursor, limit = 25 } = {}, tx = prismaClient) {
      return tx.deliveryLeg.findMany({
        where: {
          originHubPointId: { in: hubPointIds },
          status: { in: ["ASSIGNED", "READY_FOR_ASSIGNMENT", "PICKUP_VERIFICATION_PENDING"] },
          custodyHandovers: { none: { status: "PENDING_CONFIRMATION" } },
          operationalCases: { none: {
            status: { in: ["OPEN", "TRIAGED", "IN_PROGRESS"] },
            type: { in: ["FAILED_HANDOVER", "DAMAGED_PARCEL", "MISSING_PARCEL", "FAILED_DELIVERY", "ROUTE_DISRUPTION"] },
          } },
          parcelBooking: { is: { paymentStatus: "SUCCEEDED", hubIntakeRecords: { some: { hubPointId: { in: hubPointIds }, status: "RECEIVED" } } } },
          OR: [
            { assignments: { some: { status: "ARRIVED_AT_PICKUP" } } },
            { partnerAssignments: { some: { status: "ACCEPTED" } } },
          ],
        },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, parcelBookingId: true, sequence: true, type: true, status: true,
          originHubPointId: true, destinationHubPointId: true,
          parcelBooking: { select: { publicReference: true, parcelCategory: true, parcelSize: true, handlingInstructions: true } },
          originServiceZone: { select: { name: true, state: { select: { name: true } } } },
          destinationServiceZone: { select: { name: true, state: { select: { name: true } } } },
          originHubPoint: { select: { id: true, name: true, address: true } },
          destinationHubPoint: { select: { id: true, name: true, address: true } },
          assignments: {
            where: { status: "ARRIVED_AT_PICKUP" },
            select: { id: true, driverProfileId: true, status: true, driverProfile: { select: { user: { select: { fullName: true } } } } },
          },
          partnerAssignments: {
            where: { status: "ACCEPTED" },
            select: { id: true, partnerId: true, status: true, partner: { select: { displayName: true } } },
          },
        },
      });
    },
    listMyHandovers(userId, hubIds, partnerIds, driverIds, tx = prismaClient) {
      const parties = [
        { fromPartyType: "SENDER", fromPartyId: userId }, { toPartyType: "SENDER", toPartyId: userId },
        { fromPartyType: "RECIPIENT", fromPartyId: userId }, { toPartyType: "RECIPIENT", toPartyId: userId },
      ];
      for (const id of hubIds) parties.push({ OR: [{ fromPartyType: "HUB", fromPartyId: id }, { toPartyType: "HUB", toPartyId: id }] });
      for (const id of partnerIds) parties.push({ OR: [{ fromPartyType: "TRANSPORT_PARTNER", fromPartyId: id }, { toPartyType: "TRANSPORT_PARTNER", toPartyId: id }] });
      for (const id of driverIds) parties.push({ OR: [{ fromPartyType: "DRIVER", fromPartyId: id }, { toPartyType: "DRIVER", toPartyId: id }] });
      return tx.custodyHandover.findMany({
        where: { OR: parties },
        include: { deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } } },
        orderBy: [{ initiatedAt: "desc" }, { id: "desc" }],
        take: 100,
      });
    },
  };
}

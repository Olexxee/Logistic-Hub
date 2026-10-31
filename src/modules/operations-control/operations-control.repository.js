export function createOperationsControlRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async getOverview() {
      return prismaClient.$transaction(async tx => {
      const activeCaseWhere = { status: { in: ["OPEN", "TRIAGED", "IN_PROGRESS"] } };
      const [
        activeShipments,
        activeDeliveryLegs,
        failedDeliveryLegs,
        pendingCustodyHandovers,
        hubIntakeExceptions,
        activeOperationalCases,
        criticalOperationalCases,
        unassignedOperationalCases,
        activePartnerAssignments,
      ] = await Promise.all([
        tx.parcelBooking.count({
          where: { status: { in: [
            "MATCHING", "AWAITING_CUSTOMER_ACCEPTANCE", "AWAITING_PAYMENT",
            "PAYMENT_PENDING", "DRIVER_ASSIGNED", "PICKUP_VERIFICATION_PENDING",
            "PICKED_UP", "IN_TRANSIT", "DELIVERY_VERIFICATION_PENDING",
            "CANCELLATION_PENDING",
          ] } },
        }),
        tx.deliveryLeg.count({ where: { status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } } }),
        prismaClient.deliveryLeg.count({ where: { status: "FAILED" } }),
        tx.custodyHandover.count({ where: { status: "PENDING_CONFIRMATION" } }),
        tx.hubIntakeRecord.count({ where: { status: "EXCEPTION" } }),
        tx.operationalCase.count({ where: activeCaseWhere }),
        prismaClient.operationalCase.count({ where: { ...activeCaseWhere, priority: "CRITICAL" } }),
        prismaClient.operationalCase.count({ where: { ...activeCaseWhere, assignedToUserId: null } }),
        tx.partnerDeliveryAssignment.count({ where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_TRANSIT"] } } }),
      ]);

      return {
        activeShipments,
        activeDeliveryLegs,
        failedDeliveryLegs,
        pendingCustodyHandovers,
        hubIntakeExceptions,
        activeOperationalCases,
        criticalOperationalCases,
        unassignedOperationalCases,
        activePartnerAssignments,
      };
      }, { isolationLevel: "RepeatableRead" });
    },
  };
}

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
        heldParcelAssignments,
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
        tx.deliveryLeg.count({ where: { status: "FAILED" } }),
        tx.custodyHandover.count({ where: { status: "PENDING_CONFIRMATION" } }),
        tx.hubIntakeRecord.count({ where: { status: "EXCEPTION" } }),
        tx.operationalCase.count({ where: activeCaseWhere }),
        tx.operationalCase.count({ where: { ...activeCaseWhere, priority: "CRITICAL" } }),
        tx.operationalCase.count({ where: { ...activeCaseWhere, assignedToUserId: null } }),
        tx.partnerDeliveryAssignment.count({ where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_TRANSIT"] } } }),
        tx.driverAssignment.count({ where: { parcelBookingId: { not: null }, executionHoldAt: { not: null }, status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] } } }),
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
        heldParcelAssignments,
      };
      }, { isolationLevel: "RepeatableRead" });
    },
  };
}

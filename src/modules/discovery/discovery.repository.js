export function createDiscoveryRepository(prismaClient) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    findDriverProfile(userId) {
      return prismaClient.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    },

    listDriverAssignments({ driverProfileId, limit, statuses }) {
      return prismaClient.driverAssignment.findMany({
        where: { driverProfileId, status: { in: statuses } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit,
        include: {
          parcelBooking: {
            select: {
              id: true, publicReference: true, status: true, paymentStatus: true,
              pickupAddress: true, destinationAddress: true, recipientName: true, recipientPhone: true,
            },
          },
          rideBooking: {
            select: {
              id: true, publicReference: true, status: true, paymentStatus: true,
              pickupAddress: true, destinationAddress: true,
            },
          },
          deliveryLeg: {
            include: {
              originServiceZone: { select: { id: true, name: true } },
              destinationServiceZone: { select: { id: true, name: true } },
              originHubPoint: { select: { id: true, name: true } },
              destinationHubPoint: { select: { id: true, name: true } },
            },
          },
        },
      });
    },

    listUserPartnerMemberships(userId) {
      return prismaClient.transportPartnerMember.findMany({
        where: { userId },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, role: true, isActive: true, createdAt: true, updatedAt: true,
          partner: { select: { id: true, displayName: true, status: true, verificationStatus: true } },
        },
      });
    },

    listUserHubMemberships(userId) {
      return prismaClient.hubPointOperator.findMany({
        where: { userId },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, role: true, isActive: true, createdAt: true, updatedAt: true,
          hubPoint: { select: { id: true, name: true, status: true, address: true, serviceZoneId: true } },
        },
      });
    },

    async searchUsers({ query, role, status, skip, take }) {
      const where = {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(query ? { OR: [
          { fullName: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { phone: { contains: query } },
        ] } : {}),
      };
      const [items, total] = await Promise.all([
        prismaClient.user.findMany({
          where, skip, take, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, fullName: true, email: true, phone: true, role: true, status: true, emailVerifiedAt: true, phoneVerifiedAt: true, createdAt: true },
        }),
        prismaClient.user.count({ where }),
      ]);
      return { items, total };
    },

    async listAdminQuotes({ status, partnerId, bookingId, skip, take }) {
      const where = {
        ...(status ? { status } : {}),
        ...(bookingId ? { parcelBookingId: bookingId } : {}),
        ...(partnerId ? { partnerAgreement: { partnerId } } : {}),
      };
      const [items, total] = await Promise.all([
        prismaClient.shipmentQuote.findMany({
          where, skip, take, orderBy: [{ offeredAt: "desc" }, { id: "desc" }],
          include: {
            parcelBooking: {
              select: {
                id: true, publicReference: true, status: true, paymentStatus: true,
                pickupServiceZone: { select: { id: true, name: true } },
                destinationServiceZone: { select: { id: true, name: true } },
              },
            },
            partnerAgreement: { select: { partner: { select: { id: true, displayName: true } } } },
          },
        }),
        prismaClient.shipmentQuote.count({ where }),
      ]);
      return { items, total };
    },

    findPaymentAttempt(paymentAttemptId) {
      return prismaClient.paymentAttempt.findUnique({
        where: { id: paymentAttemptId },
        select: {
          id: true, provider: true, status: true, amountMinor: true, currency: true,
          initializedAt: true, verifiedAt: true, failedAt: true,
          parcelBooking: { select: { id: true, publicReference: true, status: true, paymentStatus: true, senderId: true } },
          rideBooking: { select: { id: true, publicReference: true, status: true, paymentStatus: true, passengerId: true } },
        },
      });
    },
  };
}

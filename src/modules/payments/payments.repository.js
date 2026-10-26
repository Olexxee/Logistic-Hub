export function createPaymentsRepository({ prismaClient }) {
  return {
    findBooking({ type, bookingId }) {
      return type === "RIDE"
        ? prismaClient.rideBooking.findUnique({ where: { id: bookingId }, include: { passenger: { select: { id: true, email: true, fullName: true } }, assignments: { where: { status: "AWAITING_PAYMENT" }, include: { driverProfile: { include: { settlementAccounts: true } } }, take: 1 } } })
        : prismaClient.parcelBooking.findUnique({ where: { id: bookingId }, include: { sender: { select: { id: true, email: true, fullName: true } }, assignments: { where: { status: "AWAITING_PAYMENT" }, include: { driverProfile: { include: { settlementAccounts: true } } }, take: 1 } } });
    },
    findAttemptByIdempotencyKey(idempotencyKey) { return prismaClient.paymentAttempt.findUnique({ where: { idempotencyKey } }); },
    createAttempt(data) { return prismaClient.paymentAttempt.create({ data }); },
    updateAttempt(id, data) { return prismaClient.paymentAttempt.update({ where: { id }, data }); },
    findAttemptByReference(providerReference) { return prismaClient.paymentAttempt.findUnique({ where: { providerReference }, include: { parcelBooking: true, rideBooking: true } }); },
    async settle({ attempt, verified }) {
      return prismaClient.$transaction(async (tx) => {
        const current = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } });
        if (!current) throw Object.assign(new Error("Payment attempt not found."), { statusCode: 404, code: "PAYMENT_ATTEMPT_NOT_FOUND" });
        if (current.status === "SUCCEEDED") return { replay: true };
        if (current.status !== "PENDING" && current.status !== "INITIALIZED") throw Object.assign(new Error("Payment attempt is not payable."), { statusCode: 409, code: "PAYMENT_STATE_CONFLICT" });
        if (BigInt(verified.amount) !== current.amountMinor || verified.currency !== current.currency || verified.status !== "success") {
          await tx.paymentAttempt.update({ where: { id: current.id }, data: { status: "FAILED", failedAt: new Date() } });
          return { mismatch: true };
        }
        const now = new Date();
        await tx.paymentAttempt.update({ where: { id: current.id }, data: { status: "SUCCEEDED", verifiedAt: now, providerPayload: { event: "charge.success", verifiedAt: now.toISOString() } } });
        const booking = current.rideBookingId
          ? await tx.rideBooking.update({ where: { id: current.rideBookingId }, data: { paymentStatus: "SUCCEEDED", status: "DRIVER_ASSIGNED", paidAt: now } })
          : await tx.parcelBooking.update({ where: { id: current.parcelBookingId }, data: { paymentStatus: "SUCCEEDED", status: "DRIVER_ASSIGNED", paidAt: now } });
        const assignmentWhere = current.rideBookingId ? { rideBookingId: current.rideBookingId } : { parcelBookingId: current.parcelBookingId };
        await tx.driverAssignment.updateMany({ where: { ...assignmentWhere, status: "AWAITING_PAYMENT" }, data: { status: "ACCEPTED", acceptedAt: now } });
        const account = async (code, name, type) => tx.ledgerAccount.upsert({
          where: { code },
          create: { code, name, type, currency: current.currency },
          update: {},
        });
        const clearing = await account("PAYSTACK_CLEARING", "Paystack clearing", "ASSET");
        const driverPayable = await account("DRIVER_PAYABLE", "Driver payable", "LIABILITY");
        const connectionRevenue = await account("CONNECTION_FEE_REVENUE", "Connection fee revenue", "REVENUE");
        const driverAmount = current.driverAllocationMinor ?? 0n;
        const platformAmount = current.platformAllocationMinor ?? (current.amountMinor - driverAmount);
        const entries = [
          { accountId: clearing.id, side: "DEBIT", amountMinor: current.amountMinor, description: "Verified customer payment" },
          ...(driverAmount > 0n ? [{ accountId: driverPayable.id, side: "CREDIT", amountMinor: driverAmount, description: "Driver fare payable" }] : []),
          ...(platformAmount > 0n ? [{ accountId: connectionRevenue.id, side: "CREDIT", amountMinor: platformAmount, description: "Fixed platform connection fee and disclosed charges" }] : []),
        ];
        const debit = entries.filter((x) => x.side === "DEBIT").reduce((sum, x) => sum + x.amountMinor, 0n);
        const credit = entries.filter((x) => x.side === "CREDIT").reduce((sum, x) => sum + x.amountMinor, 0n);
        if (debit !== credit) throw Object.assign(new Error("Ledger journal is unbalanced."), { statusCode: 500, code: "LEDGER_UNBALANCED" });
        const journalReference = `PAYMENT:${current.id}`;
        const existingEntries = await tx.ledgerEntry.count({ where: { journalReference } });
        if (!existingEntries) await tx.ledgerEntry.createMany({ data: entries.map((entry) => ({
          ...entry, journalReference, currency: current.currency,
          ...(current.rideBookingId ? { rideBookingId: current.rideBookingId } : {}),
          ...(current.parcelBookingId ? { parcelBookingId: current.parcelBookingId } : {}),
          paymentAttemptId: current.id,
        })) });
        await tx.bookingEvent.create({ data: {
          ...(current.rideBookingId ? { rideBookingId: current.rideBookingId } : {}),
          ...(current.parcelBookingId ? { parcelBookingId: current.parcelBookingId } : {}),
          eventType: "PAYMENT_VERIFIED", fromStatus: "AWAITING_PAYMENT", toStatus: "DRIVER_ASSIGNED",
          metadata: { paymentAttemptId: current.id, amountMinor: current.amountMinor.toString() },
        } });
        return { replay: false, bookingId: booking.id };
      });
    },
  };
}

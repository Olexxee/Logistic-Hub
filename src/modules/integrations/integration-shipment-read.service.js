import { NotFoundError } from "../../shared/http/app-error.js";

function minor(value) {
  return value == null ? null : value.toString();
}

function serializeShipment(booking) {
  const quote = booking.quotes?.[0] ?? null;
  const attestation = booking.integrationPaymentAttestation;

  return {
    id: booking.id,
    reference: booking.publicReference,
    externalFulfillmentReference: booking.externalFulfillmentReference,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    dispatchAuthorizedAt: booking.integrationDispatchAuthorizedAt ?? null,
    packingEvidenceFrozenAt: booking.integrationPackingEvidenceFrozenAt ?? null,
    currency: booking.currency,
    customerChargeMinor: minor(booking.customerPayableMinor),
    routeMode: booking.pricingSnapshot?.routeSnapshot?.routeMode ?? null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    packages: (booking.parcelPackages ?? []).map(pkg => ({
      sequence: pkg.packageSequence,
      externalPackageReference: pkg.externalPackageRef,
      category: pkg.packageCategory,
      description: pkg.description,
      weightGrams: pkg.weightGrams,
      dimensionsMm: {
        length: pkg.lengthMm,
        width: pkg.widthMm,
        height: pkg.heightMm,
      },
      assessmentStatus: pkg.assessmentStatus,
      assessmentSource: pkg.assessmentSource,
      assessedAt: pkg.assessedAt,
    })),
    deliveryLegs: (booking.deliveryLegs ?? []).map(leg => ({
      id: leg.id,
      sequence: leg.sequence,
      type: leg.type,
      status: leg.status,
      origin: leg.originServiceZone ? {
        id: leg.originServiceZone.id,
        code: leg.originServiceZone.code,
        name: leg.originServiceZone.name,
      } : null,
      destination: leg.destinationServiceZone ? {
        id: leg.destinationServiceZone.id,
        code: leg.destinationServiceZone.code,
        name: leg.destinationServiceZone.name,
      } : null,
      plannedAt: leg.plannedAt,
      assignedAt: leg.assignedAt,
      pickedUpAt: leg.pickedUpAt,
      startedAt: leg.startedAt,
      completedAt: leg.completedAt,
      failureReason: leg.failureReason,
    })),
    acceptedQuote: quote ? {
      version: quote.version,
      status: quote.status,
      currency: quote.currency,
      customerChargeMinor: minor(quote.totalCustomerChargeMinor),
      acceptedAt: quote.acceptedAt,
    } : null,
    paymentAttestation: attestation ? {
      status: "ATTESTED",
      provider: attestation.paymentProvider,
      verifiedAt: attestation.verifiedAt,
      attestedAt: attestation.attestedAt,
      deliveryChargeMinor: minor(attestation.deliveryChargeMinor),
      currency: attestation.currency,
    } : {
      status: "NOT_RECORDED",
    },
  };
}

export function createIntegrationShipmentService({ prismaClient } = {}) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  const shipmentInclude = {
    parcelPackages: {
      orderBy: { packageSequence: "asc" },
      select: {
        packageSequence: true,
        externalPackageRef: true,
        packageCategory: true,
        description: true,
        weightGrams: true,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
        assessmentStatus: true,
        assessmentSource: true,
        assessedAt: true,
      },
    },
    deliveryLegs: {
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        type: true,
        status: true,
        plannedAt: true,
        assignedAt: true,
        pickedUpAt: true,
        startedAt: true,
        completedAt: true,
        failureReason: true,
        originServiceZone: { select: { id: true, code: true, name: true } },
        destinationServiceZone: { select: { id: true, code: true, name: true } },
      },
    },
    quotes: {
      where: { status: "ACCEPTED" },
      orderBy: { version: "desc" },
      take: 1,
      select: {
        version: true,
        status: true,
        currency: true,
        totalCustomerChargeMinor: true,
        acceptedAt: true,
      },
    },
    integrationPaymentAttestation: {
      select: {
        paymentProvider: true,
        verifiedAt: true,
        attestedAt: true,
        deliveryChargeMinor: true,
        currency: true,
      },
    },
  };

  async function findOwnedShipment(clientId, shipmentId) {
    const booking = await prismaClient.parcelBooking.findFirst({
      where: {
        id: shipmentId,
        integrationClientId: clientId,
        senderId: null,
      },
      include: shipmentInclude,
    });
    if (!booking) throw new NotFoundError("Shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");

    const mapping = await prismaClient.integrationExternalReference.findFirst({
      where: {
        clientId,
        resourceType: "SHIPMENT",
        internalResourceType: "ParcelBooking",
        internalResourceId: booking.id,
      },
      select: { externalReference: true },
    });
    if (!mapping) throw new NotFoundError("Shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");

    return serializeShipment({ ...booking, externalFulfillmentReference: mapping.externalReference });
  }

  return {
    async getShipment({ clientId, shipmentId }) {
      return findOwnedShipment(clientId, shipmentId);
    },

    async getShipmentByExternalReference({ clientId, externalFulfillmentReference }) {
      const mapping = await prismaClient.integrationExternalReference.findFirst({
        where: {
          clientId,
          resourceType: "SHIPMENT",
          externalReference: externalFulfillmentReference,
          internalResourceType: "ParcelBooking",
        },
        select: { internalResourceId: true },
      });
      if (!mapping) throw new NotFoundError("Shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
      return findOwnedShipment(clientId, mapping.internalResourceId);
    },
  };
}

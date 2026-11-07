undefined

test("PostgreSQL enforces integration-owned booking identity and normalized package constraints", { skip: !enabled }, async () => {
  const tag = suffix();
  let country;
  let state;
  let zone;
  let client;
  let booking;
  let packageRecord;
  let dualOwnerUser;

  const bookingData = (overrides = {}) => ({
    publicReference: `INTEGRATION-${tag}`,
    integrationClientId: client.id,
    pickupServiceZoneId: zone.id,
    destinationServiceZoneId: zone.id,
    pickupAddress: "Integration test pickup",
    pickupLatitude: 6.5,
    pickupLongitude: 3.4,
    destinationAddress: "Integration test destination",
    destinationLatitude: 6.6,
    destinationLongitude: 3.5,
    recipientName: "Integration Recipient",
    recipientPhone: "+2348000000000",
    // Integration consignments must use parcelPackages, not these legacy fields.
    parcelCategory: null,
    parcelSize: null,
    connectionFeeMinor: 0n,
    pricingSnapshot: { source: "integration-test" },
    ...overrides,
  });

  try {
    country = await prisma.country.create({ data: { code: `T${tag}`, name: `Integration Test Country ${tag}` } });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${tag}`, name: `Integration Test State ${tag}` },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${tag}`, name: `Integration Test Zone ${tag}` },
    });
    client = await prisma.integrationClient.create({
      data: { code: `TEST_CLIENT_${tag}`, name: `Integration Test Client ${tag}` },
    });

    booking = await prisma.parcelBooking.create({ data: bookingData() });
    assert.equal(booking.senderId, null);
    assert.equal(booking.integrationClientId, client.id);
    assert.equal(booking.parcelCategory, null);
    assert.equal(booking.parcelSize, null);

    packageRecord = await prisma.parcelBookingPackage.create({
      data: {
        parcelBookingId: booking.id,
        externalPackageRef: "package-A",
        packageCategory: "carton",
        weightGrams: 1200,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        declaredValueMinor: 50000n,
        assessmentStatus: "DECLARED",
        assessmentSource: "INTEGRATOR_DECLARED",
      },
    });
    assert.equal(packageRecord.weightGrams, 1200);

    await assert.rejects(
      prisma.parcelBooking.create({ data: bookingData({ publicReference: `OWNERLESS-${tag}`, integrationClientId: null }) }),
    );
    await assert.rejects(
      prisma.parcelBooking.create({
        data: bookingData({ publicReference: `DUAL-OWNER-${tag}`, senderId: (await prisma.user.create({ data: { fullName: `Dual Owner User ${tag}` } })).id }),
      }),
    );
    await assert.rejects(
      prisma.parcelBookingPackage.create({
        data: {
          parcelBookingId: booking.id,
          externalPackageRef: "package-invalid-weight",
          packageCategory: "carton",
          weightGrams: 0,
        },
      }),
    );
    await assert.rejects(
      prisma.parcelBookingPackage.create({
        data: {
          parcelBookingId: booking.id,
          externalPackageRef: "package-invalid-value",
          packageCategory: "carton",
          declaredValueMinor: -1n,
        },
      }),
    );
  } finally {
    if (booking) await prisma.parcelBookingPackage.deleteMany({ where: { parcelBookingId: booking.id } });
    if (booking) await prisma.parcelBooking.deleteMany({ where: { id: booking.id } });
    if (client) await prisma.integrationClient.deleteMany({ where: { id: client.id } });
    if (dualOwnerUser) await prisma.user.deleteMany({ where: { id: dualOwnerUser.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

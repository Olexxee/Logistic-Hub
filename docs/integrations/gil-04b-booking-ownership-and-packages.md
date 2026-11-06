# GIL-04B — Integration-Owned Booking and Package Persistence

**Status:** GIL-04B schema and migration are implemented on the integration branch. PostgreSQL ownership/package integrity coverage has been added; runtime shipment creation is not implemented.

## Objective

Extend the existing parcel-booking aggregate to support both user-owned customer bookings and integration-owned fulfilments without creating synthetic Logistic Hub users. Preserve the current customer booking contract and persist every package declared in a GIL-03 quote as a first-class booking package.

## Verified source constraints

### Booking ownership is not a nullable-column-only change

The current `ParcelBooking` model requires `senderId` and has a required `User` relation. The following source paths depend on sender ownership:

- `src/modules/parcels/parcel-bookings.service.js`
  - `createDraft` requires a sender ID and stores it in the booking.
  - idempotency replay compares the stored sender ID with the requesting sender.
  - `getVisibleBooking` and `listVisibleDeliveryLegs` authorize customers by sender ID.
  - `listVisibleBookings` scopes customer reads to sender ID; ADMIN/SUPPORT reads are separate.
- `src/modules/parcels/parcel-bookings.repository.js`
  - customer listing is filtered by sender ID; operational listing is explicitly broader.
- `src/modules/delivery-legs/delivery-leg-dispatch.service.js`
  - customer-triggered local-driver offer requests compare `leg.parcelBooking.senderId` with the authenticated user. Hub dispatch is a separate, exact-hub membership path.
- `src/modules/partner-pricing/partner-pricing.routes.js`
  - customer quote acceptance/rejection checks booking sender ownership and emits user-attributed booking events.
- Partner execution separately gates interstate assignment on `paymentStatus = SUCCEEDED` and an accepted partner-backed `ShipmentQuote`.

The integration boundary must not be implemented by weakening these customer checks. Existing customer-facing reads and mutations must continue to reject integration-owned bookings unless a separate, explicitly authorized operational route is used.

## Data model decision

### Exactly-one-owner invariant

Implemented: `ParcelBooking.integrationClientId` is an explicit nullable relation, `senderId` is nullable, and PostgreSQL enforces the ownership invariant:

```sql
CHECK (
  (sender_id IS NOT NULL AND integration_client_id IS NULL)
  OR
  (sender_id IS NULL AND integration_client_id IS NOT NULL)
)
```

This is an ownership XOR, not an optional association. Existing rows remain user-owned. New internal customer bookings continue to set `senderId`; integration bookings set `integrationClientId`. Do not infer ownership from `senderId IS NULL` alone in application code without validating the integration relation.

Add a client/creation-time index for operational lookup. Keep the foreign key restrictive so an integration client with historical shipments cannot be deleted out from under its records.

### First-class booking packages

Implemented: `ParcelBookingPackage` is related to `ParcelBooking` and stores:

- `sequence` (stable 1-based package order, unique within a booking)
- optional `externalPackageRef` (unique within a booking when supplied)
- `packageCategory` and optional description
- declared `weightGrams`, `lengthMm`, `widthMm`, and `heightMm`
- optional `declaredValueMinor` as BigInt
- assessment status/source and assessment timestamp
- immutable package-level commercial/rate snapshot (JSON)

Persist all package rows from the selected quote session. Preserve the GIL-03 package order and external package references where supplied. Never make the first package the authoritative representation of a multi-package consignment.

Legacy `parcelCategory`, `parcelSize`, and `parcelDescription` fields remain for existing user-owned workflows and compatibility. They must not be used to reconstruct or overwrite the normalized package collection for integration-owned bookings. If legacy fields must be populated for non-null or operational display compatibility, use a documented aggregate/display convention, not a claim that one package represents the whole consignment.

## Application compatibility requirements

1. Keep `createDraft` and its user-owned idempotency behavior unchanged.
2. Add a dedicated integration booking factory/repository path; do not call `createDraft` and patch its result.
3. Make customer-facing booking and quote routes explicitly require `senderId === req.user.id`; integration-owned rows must fail closed on those routes.
4. Keep ADMIN/SUPPORT operational visibility intentional and role-gated; do not expose integration-client ownership data or package declared values unnecessarily.
5. Keep hub dispatch authorization unchanged: exact active hub, active membership and `canDispatch`.
6. Local driver fare negotiation remains unavailable for integration-owned shipments until fixed local execution pricing and a compatible non-customer dispatch/acceptance path exist. GIL-04A currently prevents local/hub-assisted integration quote options, so this is a defensive compatibility gate rather than a reason to enable those routes.
7. Partner execution must consume the accepted quote snapshot created by GIL-04C. Do not fabricate a Logistic Hub payment attempt for externally collected funds. The existing `paymentStatus = SUCCEEDED` prerequisite needs an explicit integration-verified payment state/attestation mapping in GIL-04C; it must not be satisfied by blindly setting payment fields in GIL-04B.
8. Booking events and audit events need an actor representation that supports service-originated integration actions without inventing a user ID. Keep `actorUserId` null where the schema permits it and record the authenticated `integrationClientId` in typed metadata or a dedicated actor field. Do not misattribute integration actions to ADMIN or SUPPORT.

## Migration and regression requirements

- Existing `senderId` values remain unchanged.
- Add the ownership check constraint after adding the nullable integration-client foreign key; verify there are no invalid legacy rows before applying it.
- Add package table and indexes without rewriting existing bookings into guessed package facts.
- Added PostgreSQL tests for the ownership XOR: user-only and integration-only accepted, both and neither rejected.
- Added package persistence coverage for multiple packages, nullable external references, declared values, package ordering and rate snapshots.
- Still required before GIL-04B is complete: invalid client FK coverage, rollback coverage, explicit legacy customer authorization regression tests, full PostgreSQL CI execution.
- Run Prisma validation/client generation, migration apply/history and schema-drift checks, OpenAPI/route validation, the complete Node suite and PostgreSQL integrity suite.

## Explicit non-goals

GIL-04B does not create the public shipment endpoint, external payment attestation, customer payment records, partner assignments, tracking/webhooks, refunds, payouts or settlement. Those belong to GIL-04C onward and remain gated.

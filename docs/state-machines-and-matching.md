# State Machines and Driver Matching

## Purpose

This document defines server-enforced lifecycle transitions for the initial parcel-delivery service and the later ride service. The Prisma schema is a starting relational model; it must be validated with Prisma CLI and strengthened with SQL constraints in migrations before application implementation is considered complete.

## 1. Parcel booking state machine

The persisted booking lifecycle is separate from payment, dispute and refund lifecycles. A payment can be refunded after a shipment is cancelled without overwriting the historical shipment state.

| From | To | Actor | Guard |
|---|---|---|---|
| DRAFT | MATCHING | Sender/server | Required parcel, route and contact fields are valid; pickup and destination are covered by active zones with parcel service enabled |
| MATCHING | AWAITING_CUSTOMER_ACCEPTANCE | Driver/server | Driver submits a fare proposal and the offer is still active |
| AWAITING_CUSTOMER_ACCEPTANCE | MATCHING | Sender/server | Sender declines or lets the proposed fare expire; another offer may be considered |
| AWAITING_CUSTOMER_ACCEPTANCE | AWAITING_PAYMENT | Sender/server | Sender explicitly accepts one driver's fare; the agreed fare and separate fixed connection fee are snapshotted |
| AWAITING_PAYMENT | PAYMENT_PENDING | Server | Payment attempt created idempotently for the accepted total |
| PAYMENT_PENDING | DRIVER_ASSIGNED | Server/provider verification | Provider confirms matching reference, amount, currency and success; reserved assignment becomes active |
| DRIVER_ASSIGNED | PICKUP_VERIFICATION_PENDING | Driver/server | Assigned driver reports arrival |
| PICKUP_VERIFICATION_PENDING | PICKED_UP | Server | Correct, unexpired, unused pickup token validated; handover event committed |
| PICKED_UP | IN_TRANSIT | Driver/server | Pickup already verified |
| IN_TRANSIT | DELIVERY_VERIFICATION_PENDING | Driver/server | Driver reports arrival at destination |
| DELIVERY_VERIFICATION_PENDING | COMPLETED | Server | Recipient PIN/QR or approved proof validated; completion rules satisfied |
| Any eligible pre-pickup state | CANCELLATION_PENDING | Sender/driver/support | Cancellation policy permits request |
| CANCELLATION_PENDING | CANCELLED | Server/support | Cancellation decision recorded; financial follow-up queued |
| MATCHING | FAILED | Server/worker | Matching policy exhausts its retry budget or booking expires without an acceptable offer |
| Eligible nonterminal state | FAILED | Server/support | Terminal operational failure recorded with reason |

The table is illustrative for the allowed transitions; implement a central transition function with an explicit allowlist. Never accept arbitrary `fromStatus` or `toStatus` from the client.

Use separate fields/records for:
- `paymentStatus` and payment attempts;
- cancellation request and cancellation outcome;
- dispute/support case status;
- refund records;
- driver assignment status.

This avoids one status field trying to represent several concurrent facts. A shipment can remain `PICKED_UP` while a dispute is open.

## 2. Ride lifecycle

Use the separate `RideStatus` enum and a distinct transition function. A typical path follows the same negotiation-before-payment rule as parcels:

`DRAFT → MATCHING → AWAITING_CUSTOMER_ACCEPTANCE → AWAITING_PAYMENT → PAYMENT_PENDING → DRIVER_ASSIGNED → DRIVER_EN_ROUTE → DRIVER_ARRIVED → PICKUP_VERIFICATION_PENDING → TRIP_IN_PROGRESS → TRIP_COMPLETION_PENDING → COMPLETED`

Ride-specific guards:
- Pickup and destination are covered by active zones with ride service enabled; driver and vehicle are eligible for the applicable jurisdictions and service.
- Passenger pickup PIN is valid, unused and tied to the assigned driver/trip.
- A trip cannot start before pickup is verified.
- A driver cannot self-approve a safety incident or override a payment.
- Ride cancellation, safety incidents and refunds follow explicit policies.
- Ride service must remain unavailable in a zone until local compliance requirements are confirmed and the zone's ride flag is enabled.

## 3. Assignment lifecycle and concurrency

An offer is not a confirmed assignment. Each booking stores pickup and destination service zones; both ends must be active for the requested service before matching. A driver's fare proposal must be explicitly accepted by the sender before payment. After sender acceptance, reserve the selected driver with an assignment in `AWAITING_PAYMENT`; do not expose the booking as confirmed until payment is verified. Expired or failed payment releases the reservation safely so matching can resume.

Acceptance transaction:
1. Lock or conditionally update the booking row.
2. Verify booking is still in `MATCHING`.
3. Verify offer belongs to the requesting driver, is `OFFERED`, and has not expired.
4. Revalidate driver status, verification, coverage, location freshness and workload.
5. When a sender accepts an unexpired fare proposal, atomically snapshot the driver fare, fixed connection fee and total; create a temporary assignment with `AWAITING_PAYMENT`; and withdraw competing offers.
6. Create the payment attempt only after customer acceptance. Use an idempotency key and a server-calculated total.
7. On verified provider success, atomically change the payment to succeeded, assignment to `ACCEPTED`, and booking to `DRIVER_ASSIGNED`; write ledger entries once and enqueue outbox work.
8. On payment expiry/failure, safely release the temporary assignment and resume matching according to policy.

A PostgreSQL partial unique index should enforce at most one active assignment per parcel booking and at most one active assignment per ride booking. Prisma schema alone does not express this partial index; add it through a reviewed SQL migration. Add SQL CHECK constraints requiring exactly one of `parcelBookingId` or `rideBookingId` on offers, assignments, payment attempts, payout records and other polymorphic references. Alternatively, replace polymorphic nullable foreign keys with separate typed tables if that yields clearer constraints.

## 4. Matching algorithm

### Candidate eligibility

Before ranking, filter to drivers who:
- Have an active account and verified driver profile.
- Have a verified, active vehicle appropriate to the parcel/ride.
- Are online and available.
- Have a location timestamp no older than five minutes at matching time.
- Have a latest location record within their configured `serviceRadiusMeters` of the pickup coordinates.
- Cover both pickup and destination service zones for the parcel service type.
- Are not suspended or under a safety/compliance hold.
- Have no conflicting active assignment.
- Meet parcel size/capacity and handling requirements.

Do not reveal the sender's exact pickup/destination addresses, coordinates, recipient name, or recipient phone to drivers who have not been assigned the job. Driver-facing offer cards expose the pickup and destination service-zone names plus parcel category and size only. The offer should include only the minimum information needed to decide whether to accept.

### Candidate ranking

Rank only eligible drivers. Use a configurable, explainable score composed of:
- Estimated pickup time/distance.
- Location freshness.
- Vehicle and parcel suitability.
- Recent acceptance/completion reliability.
- Recent cancellations and no-shows.
- Current workload and fair distribution.

Store score components and algorithm version for audit/debugging. Avoid protected or irrelevant personal characteristics. The ranking should not use stale GPS points as if they were current.

### Offer waves

1. A valid draft enters `MATCHING` before payment; matching tasks and offer expiry work are persisted durably.
2. Worker claims the task idempotently and changes booking to `MATCHING`.
3. Find eligible candidates in the initial radius and rank them.
4. Send a limited first wave of offers with server-generated expiry timestamps.
5. Driver acceptance is processed through the atomic transaction above.
6. If no acceptance, expire offers and widen the radius or send the next wave.
7. Stop after configured radius, wave count or timeout.
8. If no driver is found, notify the sender and close or expire the unpaid booking according to policy; no refund is due because payment has not started.

### Pseudocode

```text
match(bookingId):
  booking = load booking
  assert booking.status == MATCHING
  assert booking.paymentStatus in [INITIALIZED, FAILED, ABANDONED]
  assert serviceEnabled(booking.serviceType, booking.pickupZone)

  for wave in configuredOfferWaves:
    candidates = findDrivers(
      pickup = booking.pickupCoordinates,
      radius = wave.radius,
      serviceType = booking.serviceType,
      requiredVehicle = booking.requiredVehicle,
      parcelRequirements = booking.parcelRequirements,
      locationFreshness = configuredMaxLocationAge
    )

    candidates = filterEligible(candidates, booking)
    candidates = rankCandidates(candidates, algorithmVersion)

    if candidates is empty:
      continue

    createOffersIdempotently(booking, candidates[0:wave.limit], wave.offerTtl)
    awaitOfferResponsesUntil(wave.deadline)

    if bookingHasActiveAssignment(booking.id):
      return MATCHED

  markNoDriverFoundIdempotently(booking.id)
  queueCustomerNotificationAndApprovedRefundIfRequired(booking.id)
  return NO_DRIVER_FOUND
```

The `awaitOfferResponsesUntil` line is conceptual; production workers should use queue/scheduler primitives, not block a worker process while waiting.

## 5. Geospatial requirements

- Store latitude and longitude with range validation.
- Keep a latest-location record or a cache for fast matching; preserve history only when justified.
- Reject or downgrade stale locations.
- Use PostgreSQL geospatial indexes (for example PostGIS) for radius queries at scale.
- Keep zone eligibility separate from distance: being physically nearby does not authorise a driver to work a service that is disabled in that area.
- Allow users to search an address or drop a map pin when GPS permission is unavailable.
- Do not expose driver live location to the sender before assignment or beyond the duration/precision needed for the service.

## 6. Operational metrics

Record:
- Request-to-first-offer time.
- Request-to-acceptance time.
- Match success rate.
- Offers sent per completed booking.
- Driver acceptance and cancellation rates.
- No-driver-found rate by zone/time.
- Stale-location rejection rate.
- Pickup delay and completion rates.
- Matching failures and worker retries.

Every automated status transition must include actor/source, timestamp, reason, correlation ID and relevant non-sensitive metadata.

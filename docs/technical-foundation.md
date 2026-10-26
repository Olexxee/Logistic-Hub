# Technical Foundation

**Status:** Draft implementation specification  
**Initial market:** Multiple Lagos LGAs from day one  
**Initial service:** On-demand local parcel delivery  
**Planned services:** Passenger rides, partner drop-off points, business logistics, multi-state operations

This document defines the first implementation boundaries for the data model, booking lifecycle, payment ledger and matching algorithm. It deliberately distinguishes product decisions from provider capabilities that still require verification.

## 1. Architecture and invariants

### Initial stack

- Node.js with JavaScript ES modules.
- Express HTTP API.
- PostgreSQL as the authoritative datastore.
- Prisma for relational data access and migrations; use explicit SQL migrations for PostgreSQL features not represented fully in Prisma.
- Paystack for payment collection, subject to confirmation of the merchant account's permitted marketplace and settlement flows.
- A queue/worker and Redis may be introduced for expiring offers, throttled fan-out, retries and ephemeral coordination. PostgreSQL remains authoritative.
- Push/SMS/email are delivery channels for notifications, never the source of truth for booking state.

### Non-negotiable invariants

1. The client cannot directly set payment status, assignment ownership, pickup verification, completion or payout status.
2. Every state transition is validated on the server and recorded in an event/audit trail.
3. Payment webhooks and provider verification are idempotent.
4. A booking can have at most one active driver assignment.
5. A pickup QR/PIN can be consumed only once for the intended booking and assigned driver.
6. Driver fare and platform connection fee are separate amounts. The platform fee is not a percentage of driver fare.
7. A booking's confirmed price is immutable. Any permitted change requires a new offer/quote and customer acceptance before payment or fulfilment proceeds.
8. Parcel and ride services have separate state machines.
9. Geography exists independently of service activation: a state/LGA may be present while service is disabled.
10. Financial corrections use ledger adjustments/reversals, not silent mutation of historical entries.
11. No driver payout is marked successful until the payment provider confirms it.
12. Provider redirects are not proof of payment.

## 2. Booking lifecycle state machines

**Payment timing decision:** negotiate driver fare first, require explicit sender acceptance, then collect payment. Do not collect payment before a driver fare is accepted. Reserve the selected driver during payment initiation using a temporary assignment state; release the reservation on expiry or terminal payment failure. The agreed driver fare and fixed connection fee remain separate, immutable line items after acceptance.

**Launch geography decision:** configure multiple Lagos LGAs from day one. Do not hardcode one LGA or assume every LGA is active: use service zones and per-service availability to control actual launch coverage.

### 2.1 Parcel booking

Canonical statuses:

- `DRAFT`: client is entering shipment details; no payment attempt exists.
- `MATCHING`: eligible drivers are offered the job and can propose/negotiate a fare.
- `AWAITING_CUSTOMER_ACCEPTANCE`: at least one driver has proposed a fare; the sender must explicitly accept one.
- `AWAITING_PAYMENT`: the sender accepted a driver's fare; the agreed fare, fixed connection fee and other disclosed charges are snapshotted, and the selected driver is temporarily reserved.
- `PAYMENT_PENDING`: an idempotent payment attempt exists; provider confirmation is not final.
- `DRIVER_ASSIGNED`: server-side payment verification succeeded and the reserved assignment is confirmed.
- `PICKUP_VERIFICATION_PENDING`: driver arrived and pickup is awaiting QR/PIN validation.
- `PICKED_UP`: handover verified and custody transferred to the driver.
- `IN_TRANSIT`: shipment is in transit; may be optional as a separate status depending on product UX.
- `DELIVERY_VERIFICATION_PENDING`: driver reports arrival; recipient confirmation is pending.
- `COMPLETED`: permitted delivery proof recorded and backend completion rules passed.
- `CANCELLATION_PENDING`: cancellation request requires policy evaluation.
- `CANCELLED`: booking cancelled under the applicable policy.
- `REFUND_PENDING`: a refund is required and has been requested or queued.
- `REFUNDED`: provider-confirmed refund recorded.
- `FAILED`: booking cannot continue due to a terminal operational/payment failure.
- `DISPUTED`: support has opened a dispute; underlying facts/events are preserved.

Transitions must be explicit. Typical path:

`DRAFT → MATCHING → AWAITING_CUSTOMER_ACCEPTANCE → AWAITING_PAYMENT → PAYMENT_PENDING → DRIVER_ASSIGNED → PICKUP_VERIFICATION_PENDING → PICKED_UP → IN_TRANSIT → DELIVERY_VERIFICATION_PENDING → COMPLETED`

Exceptional paths can lead to `CANCELLED`, `FAILED`, `REFUND_PENDING` or `DISPUTED`. A dispute should not erase the underlying fulfilment state; represent dispute status independently if operational reporting needs both dimensions. Before implementation, prefer a separate `dispute_status` field rather than making `DISPUTED` replace a shipment status.

Recommended implementation refinement: use the shipment/booking lifecycle for fulfilment and separate `payment_status`, `cancellation_status` and `dispute_status` dimensions. This prevents a refund or dispute from hiding whether a parcel was picked up.

### 2.2 Assignment lifecycle

An assignment is separate from the booking:

- `OFFERED`
- `ACCEPTED`
- `ARRIVED_AT_PICKUP`
- `PICKUP_CONFIRMED`
- `IN_PROGRESS`
- `ARRIVED_AT_DESTINATION`
- `COMPLETED`
- `DECLINED`
- `EXPIRED`
- `CANCELLED`
- `FAILED`

Use database transactions and uniqueness constraints to prevent multiple active assignments for one booking. When an assignment is cancelled or fails before pickup, the booking may return to matching only after a valid server-side transition.

### 2.3 Ride lifecycle

Rides use a separate state machine:

`DRAFT → MATCHING → AWAITING_CUSTOMER_ACCEPTANCE → AWAITING_PAYMENT → PAYMENT_PENDING → DRIVER_ASSIGNED → DRIVER_EN_ROUTE → DRIVER_ARRIVED → PICKUP_VERIFICATION_PENDING → TRIP_IN_PROGRESS → TRIP_COMPLETION_PENDING → COMPLETED`

Exceptional statuses include `CANCELLED`, `NO_DRIVER_FOUND`, `PAYMENT_FAILED` and `DISPUTED`. Ride safety events and emergency-support records must not be conflated with ordinary cancellation.

### 2.4 QR/PIN verification lifecycle

Verification token statuses:

- `ACTIVE`
- `CONSUMED`
- `EXPIRED`
- `REVOKED`

Tokens must be random, single-use, scoped to one booking and one action, and expire. Store a hash of the token where practical. The QR must not encode personal data or reusable credentials. The backend checks booking, assigned driver, action type, expiry and current booking state before consuming the token in the same transaction as the handover event.

For the first release, require network validation to consume a token. Offline scanning must not mark pickup/delivery as verified. Provide a short one-time PIN fallback and a tightly controlled, audited support override.

## 3. Payment model and ledger

### 3.1 Money fields

Use integer minor units for monetary amounts (kobo for NGN). Never use floating point for money.

At quote confirmation, persist a price snapshot:

- `currency` (initially NGN).
- `driver_fare_minor`.
- `connection_fee_minor`.
- `customer_payable_minor`.
- `provider_fee_minor` when known.
- Optional taxes/other disclosed fees, if applicable.
- `pricing_rule_id` and a version/snapshot of the calculation inputs.

The invariant is:

`customer_payable = driver_fare + connection_fee + other_explicit_customer_charges`

Provider charges and their payer must be represented explicitly. Do not silently deduct a percentage from driver fare. The platform's contribution margin is not the same as the displayed connection fee; payment processing, refunds, support and operating costs still apply.

### 3.2 Payment statuses

Recommended payment-attempt states:

- `INITIALIZED`
- `PENDING`
- `SUCCEEDED`
- `FAILED`
- `ABANDONED`
- `REVERSED`

Refunds and payouts have their own records and statuses; they must not be represented by overwriting the original payment.

### 3.3 Ledger model

Use an append-only, double-entry ledger (or an equivalent balanced journal) for financial accounting. Each posted journal must balance by currency. A minimum conceptual account set:

- Payment-provider clearing.
- Customer funds received.
- Driver payable.
- Logistic Hub connection-fee revenue.
- Payment-processing expense or recoverable charge.
- Refund payable/clearing.
- Payout clearing.
- Operational adjustment/suspense, tightly restricted.

Example conceptual posting for a verified customer payment where the customer pays driver fare plus connection fee:

- Debit: provider clearing for the verified amount.
- Credit: driver payable for the agreed driver fare.
- Credit: connection-fee revenue for the platform fee.
- Credit/debit additional accounts for explicit charges and provider fees according to the confirmed provider settlement mechanics.

The precise posting accounts and timing must be reconciled to Paystack's actual settlement reports and the legal/accounting treatment. Do not treat a pending provider transaction as received cash.

A payout is a separate financial event that settles an existing driver payable. It must reference the original booking, driver payable and provider transfer reference. A failed payout leaves the payable outstanding; it does not erase the liability.

### 3.4 Payment flow

1. Server calculates and stores the final price snapshot.
2. Server creates a payment attempt with a unique internal reference and idempotency key.
3. Server initializes Paystack checkout using the exact amount and NGN currency.
4. Customer completes provider checkout.
5. Server verifies the transaction with Paystack and/or validates a signed webhook according to current Paystack documentation.
6. Server validates reference, amount, currency, status and booking association.
7. In one database transaction, record the verified provider event, mark the payment successful, post ledger entries once, promote the reserved assignment to active, and move the booking to `DRIVER_ASSIGNED`.
8. Enqueue matching through a durable outbox/job record.
9. Reconciliation compares internal records with provider transaction and settlement reports.

If a provider callback is duplicated or arrives before the redirect, idempotency ensures only one financial posting and one booking transition occur.

### 3.5 Driver settlement

Do not assume split payments provide escrow or delayed payout. Confirm Paystack product/account eligibility and terms for the intended marketplace model before choosing split payments or transfers.

Keep driver payables in the ledger and represent payout execution separately. A payout policy may require delivery completion, a dispute-free period or another approved milestone. The policy is a business/legal decision and must be configurable. Provider-confirmed payout success is the only condition for marking a payout `PAID`.

### 3.6 Cancellation/refund matrix

Before implementing, define a written matrix for:
- Payment not completed.
- Paid but no driver found.
- Driver cancels before pickup.
- Sender cancels before pickup.
- Parcel already picked up.
- Driver no-show.
- Recipient unavailable.
- Customer dispute.
- Duplicate payment.
- Provider payout failure.

Refund eligibility, any retained fee, and who bears provider costs must be explicit and legally reviewed. Do not infer that the connection fee is always non-refundable; make the policy visible before payment.

## 4. Matching algorithm

### 4.1 Eligibility before ranking

Never rank an ineligible driver. Filter drivers by:

- Verified and active account.
- Required vehicle and parcel capability.
- Service enabled for the current state/zone.
- Driver coverage includes pickup zone.
- Driver is online and available.
- Recent location within configured freshness threshold.
- Driver is not already committed to a conflicting active job.
- No suspension, safety hold or compliance expiry.
- Fare and job mode compatibility.

Use a spatial index and a configurable pickup radius. Do not rely on the driver's last known location if it is stale.

### 4.2 Candidate scoring

After eligibility filtering, rank candidates using a configurable score. Initial candidate factors:

- Pickup distance / estimated arrival time.
- Location freshness.
- Acceptance and completion reliability.
- Recent cancellation/no-show rate.
- Vehicle suitability.
- Current workload and fair opportunity distribution.

Do not let a single opaque score permanently privilege a small set of drivers. Record match inputs and ranking reasons for operational debugging. Avoid using protected or irrelevant personal characteristics.

### 4.3 Offer waves

1. Create a durable match job for a paid, unassigned booking.
2. Find and rank eligible candidates.
3. Send offers to a small first wave.
4. Each offer has a server-generated expiry.
5. First valid acceptance wins through a database transaction/conditional update.
6. Other offers become expired/withdrawn when assignment succeeds.
7. If no acceptance, widen radius and send the next wave up to configured limits.
8. If no driver is found, notify the sender and apply the approved cancellation/refund policy.

Acceptance must be atomic. Use a conditional update/row lock or unique active-assignment constraint so two drivers cannot win the same booking. An API response should clearly indicate if an offer expired or another driver secured the job.

### 4.4 Fare mode

For MVP, prefer a clear confirmed fare before payment. If the business chooses post-request driver offers, then the quote must be accepted by the sender before payment and assignment become final. Do not charge the sender for an unconfirmed offer. Avoid changing fare after payment without an explicit, authorised repricing and consent flow.

### 4.5 Matching reliability

- Use an outbox or durable job table so a crash after payment cannot lose the matching request.
- Use idempotency keys for offer creation and acceptance.
- Expire offers via a worker; correctness must not depend on a timer firing exactly on time.
- Re-check eligibility and booking state when accepting.
- Persist all offer/assignment events.
- Provide a retry and support path for no-driver-found outcomes.
- Monitor request-to-first-offer, request-to-acceptance, match success, cancellation and stale-location rates.

## 5. Multi-state and location model

Use normalized records for country, state, LGA and service zone. Keep `is_enabled`/activation and service-specific coverage separate from geographic existence.

A state may have parcel delivery active while rides are disabled. A service zone can cover part of an LGA. Hub points and drivers must be assigned to explicit supported areas.

Store latitude/longitude with validation and use PostgreSQL geospatial support for distance queries. Prisma may represent some spatial columns as unsupported types; create and maintain those columns/indexes using reviewed SQL migrations and use parameterized raw queries for spatial operations.

Keep a location's human-readable address alongside coordinates. GPS should not be the only way to specify pickup/drop-off; allow searchable address and map-pin selection.

## 6. Suggested service boundaries

- `auth`: identity, sessions and role permissions.
- `geography`: states, LGAs, zones and coverage.
- `availability`: service activation and driver coverage.
- `pricing`: fare quotes and fixed connection fee rules.
- `parcel-bookings`: parcel lifecycle and custody events.
- `matching`: candidate discovery, offers and assignment.
- `verification`: pickup/delivery QR and PIN lifecycle.
- `payments`: provider checkout, verification and webhook handling.
- `ledger`: journal posting, payables, refunds and reconciliation.
- `payouts`: driver settlement.
- `rides`: separate passenger-trip lifecycle, introduced later.
- `hub-points`: physical partner point and parcel handover.
- `notifications`: push/SMS/email dispatch.
- `support`: disputes and operational cases.
- `admin`: controlled operational actions and audit records.

Routes validate HTTP input and delegate to services. Services own business rules and transactions. The data-access layer performs persistence only. External provider calls should be isolated behind service adapters.

## 7. Implementation gates

Do not accept live bookings until all of these pass:

- Unit tests for every allowed and forbidden state transition.
- Concurrent test proving only one driver can secure a booking.
- Duplicate/out-of-order webhook tests.
- Ledger balance and duplicate-posting tests.
- QR/PIN replay and expiry tests.
- Refund and failed-payout reconciliation tests.
- Geospatial eligibility tests, including stale/offline drivers and zone boundaries.
- Authorisation tests for customer, driver, point operator and admin.
- Paystack capability/terms confirmation.
- Legal and regulatory review for the launch jurisdiction and service model.
- Operational support runbooks for lost/damaged parcels, no-driver-found, failed handover and safety incidents.

## 8. Decisions still open

- Exact Lagos launch zone(s).
- Final fare mode and whether payment occurs before or after matching.
- Connection fee amount and whether it varies by service zone.
- Driver payout milestone and permitted provider mechanism.
- Cancellation/refund policy.
- Initial identity/vehicle verification provider and process.
- Whether the first deployment uses Redis/queue infrastructure or PostgreSQL-backed jobs.
- Ride launch timing and regulatory approval.
- Partner-point custody and liability terms.

Recommended MVP default: confirm the fare and fee first, collect payment, verify payment server-side, match the job, verify pickup, record delivery, and settle the driver's payable only under a confirmed provider-compatible policy.

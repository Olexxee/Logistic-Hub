# DRV-05B — Assignment Execution Eligibility

**Status:** Implemented in [PR #125](https://github.com/Olexxee/Logistic-Hub/pull/125); CI passed on head `4737c98dc13e8d71bb1a3f219202bbaafcfc295e`. Staging acceptance pending. This slice enforces parcel-driver eligibility immediately before custody transfers and defines an audited continuity path after custody has transferred.

## Source baseline

- Backend repository: `Olexxee/Logistic-Hub`
- Base branch: `main`
- Base commit: `69d88045b9d0b0b5f1d299c2b323ffc1a954f5ee`
- DRV-05A merged in PR #124.

## Parcel capability and vehicle checks

Before a parcel driver can mark arrival at pickup or consume the pickup verification code, the transaction rechecks:

1. Driver profile remains `VERIFIED`, not suspended, and within the configured KYC tier.
2. Driver's user account remains active, email-verified and has the `DRIVER` role.
3. The driver still has an `APPROVED` grant for the exact operation:
   - Direct parcel: `LOCAL_DISPATCH`
   - `LOCAL_PICKUP`: `PICKUP_COLLECTION`
   - `FINAL_MILE`: `FINAL_MILE_DELIVERY`
4. The origin and destination service zones remain active with current parcel availability; the driver still has enabled parcel coverage in both zones. Any hub on the delivery leg must remain active.
5. The assignment has an exact selected `vehicleId`; the vehicle still belongs to the driver, is active and verified, and has the matching approved service suitability.
6. In STRICT KYC mode, identity, driver licence and vehicle-registration evidence remain approved and non-expired, subject to the existing bicycle exemption.

A missing legacy vehicle binding is not guessed. It returns `VEHICLE_NOT_BOUND` and requires operations review before pickup. A driver assignment for a partner-only leg is rejected by the driver eligibility predicate.

These checks run in a serializable transaction with bounded retry for PostgreSQL serialization conflicts, so a concurrent Admin change cannot silently race past the pickup gate. They happen before pickup custody can transfer. They do not require the driver's current availability flag or a fresh dispatch location: the driver is already reserved for this assignment, and these are not appropriate in-flight execution gates.

## Custody continuity after pickup

Once the sender's pickup code has been consumed, the parcel is in the driver's custody. Rechecking the same eligibility gate at every later step can strand the parcel if an Admin suspends the driver, revokes a grant or evidence expires mid-route.

Therefore:

- Post-pickup progression (`IN_PROGRESS`, `ARRIVED_AT_DESTINATION`) is not blocked solely because the driver's general dispatch eligibility changed after custody transfer.
- Delivery verification remains available to the same assigned driver, subject to assignment ownership, assignment state and the one-time verification token rules.
- If the driver is no longer eligible at delivery completion, the transaction records `IN_CUSTODY_ELIGIBILITY_EXCEPTION_COMPLETED` with the assignment, driver, selected vehicle and reason code.
- This exception does **not** restore driver availability, reinstate the driver, renew a capability or approve a vehicle. Normal matching remains blocked by DRV-05A.
- Passenger rides retain their previous profile/KYC gate; this parcel-specific policy does not alter ride execution.

This is a continuity policy, not a blanket permission to ignore a security incident. An Admin/SUPPORT operator must handle a known safety incident through operational response and arrange a controlled custody handover where needed. The current operational-case model does not provide a dedicated assignment execution hold/recovery action; that remains a follow-up requirement before claiming complete incident-response automation.

## Stable conflict codes

- `DRIVER_EXECUTION_ELIGIBILITY_CHANGED`
- `VEHICLE_EXECUTION_ELIGIBILITY_CHANGED`
- `VEHICLE_NOT_BOUND`
- `LEG_REQUIRES_PARTNER_EXECUTION`
- `SERVICE_ZONE_UNAVAILABLE`
- `HUB_UNAVAILABLE`

The service maps these to HTTP 409 conflict responses. Ownership failures remain 403; invalid/expired verification codes retain their existing code.

## Data and migration impact

- No Prisma schema change or migration.
- No backfill of historical assignments with guessed vehicle IDs.
- No changes to fare, reservation, payment, payout or driver availability behavior.
- No change to partner-only hub-transfer/interstate execution.
- No change to passenger-ride execution.
- A new booking event is written when in-custody delivery completes despite an eligibility change.

## Deliberate remaining work

- Add an explicit Admin-controlled safety hold and controlled reassignment/custody-recovery workflow for critical driver incidents while a parcel is in transit.
- Define automated operational-case creation/notification when a pre-custody assignment becomes ineligible, plus safe assignment release/reassignment.
- Complete staging acceptance for direct, pickup and final-mile flows, including suspension/revocation between each lifecycle checkpoint.
- Complete DRV-05 partner corridor/vehicle-capacity policy only if the approved partner/interstate operating contract brings it into this workstream. Current local-driver scope still excludes those legs.

## Validation

- Predicate tests prove the assignment execution query requires active account, driver capability, exact vehicle suitability, active route coverage and strict-mode evidence without incorrectly requiring online/available state.
- Repository tests prove eligibility changes block pre-custody arrival and pickup verification.
- Repository tests prove post-pickup continuation is preserved and an eligibility exception is audited at delivery completion.
- Full `npm test` passed: 608 tests, 607 passed, 0 failed. Prisma validation/generation, OpenAPI validation, migration application/history and schema-drift checks also passed in CI.
- Staging acceptance remains separate from merge status.

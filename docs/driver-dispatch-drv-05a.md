# DRV-05A — Parcel Dispatch Eligibility Enforcement

**Status:** Implemented on branch `feat/drv-05-dispatch-eligibility`; PR/CI and staging acceptance pending. This is the first implementation slice of DRV-05, not completion of the entire phase.

## Source baseline

- Backend repository: `Olexxee/Logistic-Hub`
- Base branch: `main`
- Base commit: `2f5cb8f7bb2759351644f2f9e5383d2232dd478a`
- DRV-04 frontend PR #51 is merged at `707ef7995bf905a26b09c9cad731fcc8b1512c0a`.

## Capability mapping

| Parcel operation | Delivery-leg type | Required driver capability | Required vehicle suitability |
|---|---|---|---|
| Direct same-state parcel dispatch | `DIRECT` | `LOCAL_DISPATCH` | `LOCAL_DISPATCH` |
| Sender pickup / collection | `LOCAL_PICKUP` | `PICKUP_COLLECTION` | `PICKUP_COLLECTION` |
| Recipient final mile | `FINAL_MILE` | `FINAL_MILE_DELIVERY` | `FINAL_MILE_DELIVERY` |

Only explicit `APPROVED` grants qualify. A verified driver with an active verified vehicle is insufficient without both grants. The helper returns no driver capability for `HUB_TRANSFER` or `INTERSTATE_TRANSPORT`; those remain partner-only.

## Enforcement boundaries implemented

1. **Candidate matching**
   - Direct local matching filters on the approved driver grant and at least one active, verified vehicle with the corresponding approved vehicle suitability.
   - Delivery-leg candidate matching applies the same pair-specific requirement based on leg type.
   - Candidate queries continue to enforce user account state, driver verification/KYC, suspension, online/available state, active assignment exclusion, location freshness and service coverage.
2. **Fare proposal**
   - The driver grant is rechecked after offer retrieval.
   - The exact selected vehicle must be owned by the driver, active, verified and approved for the leg capability.
   - In STRICT KYC mode, expired evidence is excluded at proposal time.
3. **Customer fare acceptance / reservation**
   - The exact driver grant and selected vehicle suitability are rechecked.
   - Reservation remains a conditional update that requires an active driver, fresh location, service coverage and no conflicting active assignment.
   - Direct dispatch rechecks that the driver's latest location is still within the pickup radius.
   - Delivery-leg acceptance rechecks driver location/radius and current origin/destination zone availability.
4. **Service zones**
   - Delivery-leg offer creation and acceptance require active zone, state and country plus currently enabled parcel availability.
   - Direct parcel matching already had this check; direct fare acceptance now repeats it.
5. **Location freshness**
   - Legacy direct matching and delivery-leg matching/reservation use `DRIVER_LOCATION_MAX_AGE_SECONDS`; the delivery-leg five-minute literal is removed.
6. **Strict document expiry**
   - STRICT-mode dispatch requires a currently approved, non-expired identity document.
   - Motorized vehicles additionally require a currently approved, non-expired driver licence and vehicle-registration document.
   - Bicycles retain the existing class-specific exemption from the motor-vehicle licence/registration pair.
   - A null `expiresAt` remains valid under the existing policy; no expiry date is inferred.

## Stable conflict codes introduced/used

- `DRIVER_CAPABILITY_NOT_APPROVED`
- `DRIVER_CAPABILITY_NO_LONGER_APPROVED`
- `VEHICLE_NOT_ELIGIBLE`
- `VEHICLE_NO_LONGER_ELIGIBLE`
- `SERVICE_ZONE_UNAVAILABLE`
- `DRIVER_NO_LONGER_AVAILABLE`

Existing offer, booking, KYC and partner-only error codes remain intact.

## Data and migration impact

- No Prisma schema change.
- No migration or backfill.
- No implicit capability approval.
- No change to passenger-ride dispatch.
- No change to partner-only hub-transfer/interstate execution.
- No production deployment or migration performed.

## Deliberate remaining DRV-05 work

This PR does **not** complete all of DRV-05:

- Revalidate capability, vehicle suitability, expiry, driver status and route authorization at assignment execution transitions, while preserving a safe custody-completion path for already-held parcels.
- Define an explicit policy for what happens to already-issued offers when a grant is suspended/revoked; current proposal/acceptance checks prevent them from being used.
- Apply partner corridor and vehicle capacity checks only when the product's partner/interstate contract is in scope. `Vehicle.parcelCapacity` is currently free text and cannot support a reliable numeric capacity decision.
- Add hub-transfer authorization only if/when the hub-transfer execution model is intentionally extended to local drivers; current contract keeps those legs partner-executed.
- Complete cross-role acceptance and staging verification.

## Validation plan

- Unit tests for capability mapping, strict document expiry predicates and active-zone predicates.
- Dispatch service tests for direct matching, fare proposal and reservation-time location checks.
- Delivery-leg tests for pickup/final-mile mapping, zone availability, capability checks and configured location freshness.
- Full `npm test`, Prisma validation/generation and API contract validation in CI.
- Staging acceptance must be recorded separately from PR merge status.

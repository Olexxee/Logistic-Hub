# Driver & Vehicle Operations — Product and Implementation README

**Workstream:** DRV  
**Repositories:** [Logistic Hub backend](https://github.com/Olexxee/Logistic-Hub) · [Logistic Hub frontend](https://github.com/Olexxee/logistic-frontend)  
**Status:** DRV-00 through DRV-02 backend contracts are merged; DRV-03 Admin workspace and DRV-04 driver self-service workspace are merged in the frontend. DRV-05A parcel-dispatch eligibility enforcement is implemented on branch `feat/drv-05-dispatch-eligibility`; PR/CI and staging acceptance are pending. The remaining DRV-05 execution-boundary and partner-authorization work is still open.

## 1. Objective

Build one coherent **Driver & Vehicle Operations** workspace for platform administrators to manage every driver and every registered vehicle (including motorcycles/bikes) from a single place.

The workspace must let authorized Admins determine which operational services a driver is approved to perform and which services each of their vehicles is suitable and approved to perform.

This is an extension of the existing driver, vehicle, KYC, dispatch, availability and assignment foundations. It is not a rewrite, a second identity system or a new ride-hailing product.

The driver-facing experience remains a separate self-service surface for a driver to manage their own profile, documents, vehicles, availability and assignments. The unified Admin workspace is the central oversight and decision surface across all drivers and vehicles.

## 2. Product decisions

### 2.1 One driver identity; multiple approved capabilities

A person has one user account and one driver profile. Do not create separate accounts or mutually exclusive account types for local dispatch, pickup, hub transfer or inter-state transport.

A driver may request and be approved for more than one service capability. Capabilities are explicit, independently reviewable and revocable. Being approved for one capability must not implicitly grant another.

Initial parcel-logistics capabilities:

- **LOCAL_DISPATCH** — short-distance, same-city parcel delivery.
- **PICKUP_COLLECTION** — collect parcels from senders and move them to the next approved point.
- **FINAL_MILE_DELIVERY** — deliver parcels from a hub/receiving point to the recipient.
**Not in the initial driver capability set:** hub transfers and inter-state transport. The current delivery-leg dispatch service explicitly reserves `HUB_TRANSFER` and `INTERSTATE_TRANSPORT` legs for transport-partner execution. Do not make them driver capabilities unless the operating model is deliberately changed and separately approved.

These are operational capabilities, not global authentication roles. Backend authorization continues to use the existing user role and ownership model. An Admin selecting a capability does not turn a user into an Admin, partner or hub operator.

Passenger rides remain a separate product/domain. Do not include PASSENGER_RIDE in the first release of this workstream or infer ride eligibility from parcel capabilities. Existing TEST_LIMITED KYC restrictions continue to block passenger-ride offers.

### 2.2 One vehicle registry; multiple vehicle classes

All vehicles are managed in the same registry and the same Admin workspace. Vehicle class is data, not a separate dashboard or account type.

Initial vehicle classes:

- **BICYCLE** — pedal bicycle.
- **MOTORCYCLE** — motorbike / dispatch motorcycle.
- **CAR** — eligible car.
- **VAN** — delivery van.
- **PICKUP** — pickup truck (the existing Prisma enum value is `PICKUP`).
- **TRUCK** — eligible goods vehicle.

The vehicle type catalogue must be configurable or safely extensible; do not scatter hard-coded vehicle lists across unrelated screens.

A driver may register multiple vehicles. Each vehicle belongs to one driver profile and has its own status, documents, verification history and service suitability. The system must not assume that every vehicle owned by a driver is approved for every service.

### 2.3 Driver capability and vehicle suitability are separate

The driver is approved for a service capability; a particular vehicle is separately approved as suitable for that capability. An assignment is eligible only when all required checks pass:

1. Driver account is active and not suspended.
2. Driver profile verification and KYC tier permit the requested operation.
3. Driver has the required active, Admin-approved capability.
4. The selected vehicle is active, verified and approved for that capability.
5. The vehicle's class and capacity satisfy parcel/service restrictions.
6. Driver and vehicle are covered for the route/service zone.
7. Driver is online/available, location is sufficiently fresh, and no conflicting active assignment exists.
8. Any route, hub, partner or corridor authorization required by the assignment is valid.

A driver capability must not override vehicle restrictions; vehicle approval must not grant a driver capability.

### 2.4 Central Admin workspace, not duplicated screens

Extend the existing Admin driver verification workspace at **/admin/driver-verification** into the unified Driver & Vehicle Operations workspace. It already has driver and vehicle queues with linked detail panels; do not create a duplicate Admin route unless the source audit proves that extension is impractical.

The workspace must support:
- All-driver directory, search, pagination and filters.
- All-vehicle registry, search, pagination and filters.
- Driver detail with identity/profile, KYC, documents, approved/requested capabilities, vehicles, service coverage, availability, location freshness, assignment history and audit history.
- Vehicle detail with owner, class, registration identifiers, service suitability, documents, verification, status and assignment usage.
- Review queues for driver applications, capability requests, vehicle registrations and document renewals.
- Explicit approve, reject, suspend, reactivate and revoke decisions, each authorized, reasoned and audited.
- A clear view of which driver/vehicle pair is eligible for which service and why a candidate is ineligible.

The UI may provide tabs or linked views, but must use one consistent Admin workspace and shared filters/status vocabulary. Do not create separate Admin dashboards for bikes, cars, local dispatch riders and interstate drivers.

## 3. Existing foundation and boundaries

The following capabilities are documented as existing in the repositories and must be verified against current source/API contracts before extension:

- Driver onboarding/profile and Admin verification.
- Vehicle creation and vehicle verification.
- Private driver/vehicle evidence upload and Admin document review.
- TEST versus STRICT KYC tiers and reapplication rules.
- Driver service coverage, availability and location freshness.
- Local parcel opportunities, delivery-leg assignments and assignment execution.
- Hub custody as a separate two-party handover lifecycle.
- Admin platform/operations workspace and backend authorization.

Relevant policies:
- [Driver verification and staged KYC](./driver-kyc-policy.md)
- [Driver assignment lifecycle policy](./driver-assignment-lifecycle-policy.md)
- [Current implementation stopping point](./current-implementation-status.md)
- [Frontend implementation status](https://github.com/Olexxee/logistic-frontend/blob/main/docs/frontend-implementation-status.md)

Do not infer that a capability is complete because a route, page or type exists. Audit mounted routes, validators, service/repository behavior, schema constraints, frontend integration and tests.

### KYC and compliance constraints

- Production driver operations require STRICT KYC. TEST_LIMITED is for controlled local/staging testing only and must never be used against production data.
- TEST_LIMITED drivers remain restricted to local parcel delivery and do not accrue payout records.
- Strict-mode evidence currently includes identity and, for non-bicycle vehicles, driver-license and vehicle-registration evidence. The existing policy explicitly does not claim that all statutory requirements are implemented.
- Insurance and roadworthiness documents exist but are not currently mandatory under the documented initial policy. Confirm applicable legal/compliance requirements before making them mandatory.
- Document expiry enforcement, malware scanning and a retention/deletion policy are release gates before real identity evidence is collected.
- Do not expose private document URLs or weaken existing ownership/access checks.

## 3A. DRV-00 source audit — completed 8 November 2026

**Audited default-branch baselines**
- Backend `Olexxee/Logistic-Hub`: `19e34498acd556aa92c58afa1a7aec28de517a64`.
- Frontend `Olexxee/logistic-frontend`: `7bd5ebc0a946babadbc2700e1c5438d4592deff5`.

This is a source audit of schema, mounted route modules, validators/services/repositories, OpenAPI paths, frontend routes/pages/API modules, and existing tests. It is not staging or production acceptance.

### Confirmed existing foundation

| Area | Source-backed finding | Audit result |
|---|---|---|
| Driver identity | `DriverProfile.userId` is unique; one user has at most one driver profile. User platform role is `DRIVER`, not a separate account per service. | Implemented |
| Multiple vehicles in data model | `DriverProfile.vehicles` is one-to-many. The `Vehicle` model already supports multiple vehicles per profile. | Implemented in schema |
| Vehicle classes | Existing enum: `BICYCLE`, `MOTORCYCLE`, `CAR`, `VAN`, `PICKUP`, `TRUCK`. Bicycles and motorcycles are already distinct classes. | Implemented in schema |
| Initial vehicle onboarding | `POST /drivers/onboarding` creates a driver profile and exactly one vehicle in a transaction. A second onboarding attempt is rejected when the profile exists. | Partial |
| Additional vehicle lifecycle | No driver-owned endpoint exists to add, edit, replace or deactivate another vehicle after onboarding. | Missing |
| Vehicle assignment binding | `DriverAssignment`, `DriverOffer` and `DeliveryLegOffer` reference the driver profile but have no `vehicleId`. Matching checks whether the driver has *some* active verified vehicle; it does not select or bind the vehicle used for a job. | Missing; critical |
| Driver service coverage | `DriverCoverage` is keyed by driver, service zone and broad `ServiceType` (`PARCEL_DELIVERY`, `PASSENGER_RIDE`, `HUB_POINT`, `BUSINESS_LOGISTICS`). Coverage is set through an Admin-only endpoint. | Implemented, but not granular driver-role approval |
| Operational driver work | Direct same-state parcel matching and delivery-leg driver dispatch exist. Delivery-leg drivers are currently limited to `LOCAL_PICKUP` and `FINAL_MILE`. | Implemented |
| Partner-only leg types | Delivery-leg dispatch rejects `HUB_TRANSFER` and `INTERSTATE_TRANSPORT` for local drivers with `LEG_REQUIRES_PARTNER_EXECUTION`. | Explicit boundary |
| Driver KYC and verification | Profile verification, KYC tier, suspension, vehicle verification and document review are separate checks. TEST_LIMITED remains restricted; STRICT mode requires identity evidence and, for non-bicycle vehicles, driver licence and vehicle registration evidence. | Implemented with stated policy limits |
| Vehicle evidence | Documents may be linked to a specific vehicle; supported types include registration, insurance and roadworthiness. `expiresAt` is stored. Expiry enforcement is not implemented. | Partial |
| Admin driver/vehicle operations | Backend supports paginated driver/vehicle lists, profile/vehicle verification, driver suspension/reactivation, driver audit, document review and coverage assignment. | Partial |
| Admin frontend | `/admin/driver-verification` already has Driver Applications and Vehicle Verification queues, linked details, KYC status, vehicles, coverage and documents. It lacks general search and capability/suitability management. | Partial; reuse this workspace |
| Driver frontend | `/drivers` is a profile/onboarding screen. Dispatch opportunities (`/dispatch`) and assignments (`/assignments`) are separate pages. The profile displays all vehicles returned by the API but has no add-vehicle flow. | Partial |
| Public recruitment | `/become-a-driver` is present on the current frontend main branch and directs applicants through registration to the existing onboarding route. | Implemented in merged code |
| API contract | Current driver, vehicle, document, coverage, Admin, dispatch and assignment endpoints are represented in `docs/openapi.yaml`. | Existing contracts documented |

### Existing routes and screens

| Workflow | Backend contract | Frontend |
|---|---|---|
| Read own driver profile | `GET /drivers/me` | `/drivers` |
| Submit initial driver + first vehicle | `POST /drivers/onboarding` | `DriverOnboardingForm` on `/drivers` |
| Reapply after rejection | `POST /drivers/me/reapply` | Reapplication form in driver profile |
| Upload/list own documents | `POST/GET /drivers/me/documents` | `DriverDocumentsPanel` |
| Driver availability/location | `PATCH /drivers/availability`, `POST /drivers/location` | Availability control; location integration is separate |
| Admin driver/vehicle queues | `GET /drivers/admin/drivers`, `GET /drivers/admin/vehicles` | `/admin/driver-verification` |
| Admin verification | `PATCH /drivers/admin/{driverProfileId}/verification`, `PATCH /drivers/admin/vehicles/{vehicleId}/verification` | Driver and vehicle review flows |
| Admin driver status/audit | `PATCH /drivers/admin/drivers/{driverProfileId}/status`, `GET /drivers/admin/drivers/{driverProfileId}/audit` | Backend contract exists; unified UI integration is incomplete |
| Admin document review | `GET/PATCH /drivers/admin/documents...` | `AdminDriverDocumentsPanel` |
| Admin coverage | `PUT /drivers/admin/coverage` | Coverage is visible in the Admin driver detail; dedicated management integration needs audit/extension |
| Local parcel opportunities | `GET /driver/offers`, `GET /driver/delivery-leg-offers` | `/dispatch` |
| Driver assignment execution | `GET /assignments/mine` and assignment lifecycle endpoints | `/assignments` |

### Critical design gaps established by the audit

1. **Do not add a second vehicle-to-driver relation.** The existing one-to-many relation already supports multiple vehicles. The missing work is the add/edit/deactivate API and user interface.
2. **A job cannot currently identify its operating vehicle.** No offer or assignment stores `vehicleId`. Before enforcing vehicle-specific service suitability, add a safe vehicle-selection/binding contract and persist that choice on the assignment. Revalidate the vehicle at offer/acceptance/execution boundaries as required.
3. **Broad service coverage is not a driver role.** `DriverCoverage.serviceType` says which broad service is enabled in a zone; it does not express independently requested/approved capabilities such as local dispatch, pickup collection or final-mile delivery. Do not overload `ServiceType` or global `UserRole` to represent those capabilities.
4. **Do not expose partner work as driver roles.** Hub-transfer and interstate legs are explicitly partner-executed today. The initial driver role set should be local dispatch, pickup collection and final-mile delivery only.
5. **Extend the existing Admin workspace.** The existing driver-verification page already unifies driver and vehicle review queues. Expand and rename it rather than create a second dashboard that duplicates lists and review state.
6. **Vehicle requirements are class-aware.** Bicycle is exempt from the current strict-mode motor-vehicle registration/licence pair. The registration plate is optional in the current schema and onboarding validator; any change to make it mandatory needs a deliberate class-specific rule and migration/validation plan.
7. **Document expiry is only stored, not enforced.** Expiry reminders and expiry-based eligibility must not be represented as existing functionality.
8. **Current Admin list APIs are paginated but limited.** Driver filters cover verification status and KYC tier; vehicle filters cover verification status and active state. Neither currently supports free-text search, vehicle type, capability or service-area filters.
9. **Current tests cover the foundation, not the new model.** Existing tests cover Admin role restrictions and pagination, verification lifecycle, TEST_LIMITED restrictions, private document upload/review/download, dispatch eligibility, and rejection of partner-only leg types. There are no tests for adding a second vehicle, vehicle selection on an assignment, capability approval/revocation, or per-vehicle service eligibility.
10. **Delivery-leg eligibility does not fully match the documented availability policy.** The delivery-leg dispatch repository checks broad parcel coverage but does not revalidate the current service-zone/country active state or time-bounded `PARCEL_DELIVERY` availability at offer creation. The legacy direct-dispatch path does check active geography and availability. In addition, delivery-leg matching hardcodes a five-minute location freshness window while the shared policy/configuration defines `DRIVER_LOCATION_MAX_AGE_SECONDS`. These must be reconciled before role-based matching is expanded.
11. **Some Admin controls are backend-only.** Driver suspension/reactivation and driver audit-list endpoints exist, but the current frontend Admin driver-verification API/page does not expose those controls or the audit timeline. The Admin document panel and verification decisions are integrated.

### DRV-00 completion decision

- [x] Prisma driver, vehicle, document, coverage, assignment and audit models inspected.
- [x] Mounted driver self-service and Admin route modules, validators, services and repositories inspected.
- [x] OpenAPI paths reconciled against mounted route contracts.
- [x] Frontend driver pages, Admin route/navigation, API modules and role guards inspected.
- [x] Existing one-to-many vehicle support and missing lifecycle operations identified.
- [x] Existing coverage model, missing granular capability model, and missing assignment vehicle binding identified.
- [x] Existing tests and uncovered acceptance cases inventoried.
- [x] Source-backed gap matrix recorded above.

**DRV-00 is complete. No schema migration, API, frontend or production changes were made as part of this audit.**

## 4. Work breakdown and delivery sequence

Each phase should be a focused PR or a small set of reviewable PRs. Backend/API contracts and tests lead; frontend consumes only verified contracts. Keep rides separate. Update this document and the relevant implementation-status documents after each merged phase.

### DRV-00 — Source audit and acceptance baseline

**Goal:** Establish exactly what exists before changing the schema or UI.

- [x] Inspect Prisma driver, vehicle, document, service-zone, assignment and audit models.
- [x] Inventory mounted driver/vehicle Admin and self-service routes, validators, services and repository methods.
- [x] Reconcile OpenAPI paths against mounted route contracts.
- [x] Inventory frontend driver pages, Admin navigation, API modules and role guards.
- [x] Record existing one-to-many vehicle support and missing lifecycle operations.
- [x] Identify missing capability approval, vehicle-to-assignment binding, list/detail/filter/review gaps and test coverage.
- [x] Produce the source-backed gap matrix in Section 3A; no schema migration or UI rewrite in this phase.

**Acceptance:** every planned mutation and screen maps to an existing verified contract or a specifically identified backend change.

### DRV-01 — Domain model and backend capability contracts

**Goal:** Represent driver capabilities and vehicle service suitability without conflating them with platform roles.

- [x] Confirm `DriverCoverage` is broad zone/service availability, not a granular operational capability; retain it unchanged.
- [x] Add normalized `DriverCapabilityGrant` records with REQUESTED, APPROVED, REJECTED, SUSPENDED and REVOKED lifecycle states.
- [x] Add normalized `VehicleServiceCapability` records using the same parcel capability catalogue and independent approval lifecycle.
- [x] Preserve the existing one-to-many vehicle relation; allow one driver to request multiple capabilities and each owned vehicle to request capabilities independently.
- [x] Preserve all existing driver/vehicle records through an additive migration; do not backfill or silently grant capabilities to existing profiles.
- [x] Add Admin review, rejection, suspension and revocation endpoints with required reason and transactional operational audit events.
- [x] Add owner-scoped driver capability and per-vehicle suitability read/request endpoints; clients cannot submit decision fields.
- [x] Define initial stable eligibility/conflict codes for dispatch and fare-reservation consumers; assignment-execution reason coverage remains in DRV-05.
- [x] Update OpenAPI and add route-level authorization/request validation tests; no seed/backfill is required because existing drivers receive no implicit capability.

**Acceptance:** route tests prove that driver requests are created only as REQUESTED, caller-supplied decision fields are rejected, and driver accounts cannot call Admin review routes. Admin approval additionally requires a verified, non-suspended driver with FULL KYC (or TEST_LIMITED only for LOCAL_DISPATCH in TEST mode); vehicle suitability approval also requires that exact vehicle to be active and verified. Capability approval remains separate from profile verification and is consumed by DRV-05A matching/proposal/reservation checks; assignment execution revalidation remains open.


#### DRV-01 implementation contract

**Merged in backend PR #122.**

- `DriverServiceCapability`: `LOCAL_DISPATCH`, `PICKUP_COLLECTION`, `FINAL_MILE_DELIVERY`.
- `CapabilityApprovalStatus`: `REQUESTED`, `APPROVED`, `REJECTED`, `SUSPENDED`, `REVOKED`.
- `DriverCapabilityGrant`: one record per driver/capability pair.
- `VehicleServiceCapability`: one record per vehicle/capability pair.
- Rejected/revoked requests may be resubmitted; requested/approved/suspended requests cannot be duplicated.
- Admin decisions require a 10–500 character reason and are written to `OperationalAuditEvent` in the same transaction as the state change.
- Driver capability approval requires a verified, non-suspended driver profile with FULL KYC, or TEST_LIMITED only for LOCAL_DISPATCH in TEST mode. Vehicle suitability approval additionally requires the selected vehicle itself to be active and verified.
- No existing driver or vehicle is backfilled as approved. Existing records begin with no capability grants.
- Capability grants are consumed by DRV-05A matching, fare proposal and reservation checks. Assignment execution revalidation remains open in DRV-05.

**API**
- `GET/POST /drivers/me/capabilities`
- `GET/POST /drivers/me/vehicles/:vehicleId/capabilities`
- `GET /drivers/admin/drivers/:driverProfileId/capabilities`
- `PATCH /drivers/admin/drivers/:driverProfileId/capabilities/:capability`
- `GET /drivers/admin/vehicles/:vehicleId/capabilities`
- `PATCH /drivers/admin/vehicles/:vehicleId/capabilities/:capability`

### DRV-02 — Vehicle registration and verification lifecycle

**Goal:** Complete the multi-vehicle lifecycle, including motorcycles and bicycles.

- [x] Register additional vehicles for an existing driver; every new vehicle starts PENDING and inactive.
- [x] Edit unverified vehicle metadata; verified vehicle identity/specifications are immutable and require a replacement vehicle.
- [x] Deactivate/retire vehicles with active parcel-assignment safety checks; force the driver offline if no other verified active vehicle remains.
- [x] Reuse the existing class-aware KYC gate: bicycles are exempt from the motor-vehicle registration/license pair; motorized vehicles require approved vehicle-registration and driver-license evidence in STRICT mode.
- [x] Accept optional document expiry timestamps, reject past expiry on upload, and prevent Admin approval of already expired evidence.
- [x] Persist the selected vehicle on direct parcel and delivery-leg fare offers and copy it to the resulting assignment.
- [x] Revalidate that the exact selected vehicle remains owned by the driver, active and verified at customer fare acceptance.
- [x] Preserve historical assignment references with nullable vehicle foreign keys and RESTRICT deletion semantics; vehicle retirement never deletes the record.
- [ ] Enforce expiry dynamically in all dispatch/matching and in-progress execution checks; DRV-05 owns the unified eligibility gate.
- [x] Consume approved driver and vehicle capability grants during matching, fare proposal and customer reservation; in-progress execution checks remain DRV-05 work.

**API**
- `GET /drivers/me/vehicles`
- `POST /drivers/me/vehicles`
- `PATCH /drivers/me/vehicles/:vehicleId`
- `POST /drivers/me/vehicles/:vehicleId/deactivate`
- Fare proposal requests accept an optional `vehicleId` only when exactly one active verified vehicle exists; multi-vehicle drivers must choose explicitly. The assignment records the chosen vehicle.

**Acceptance:** a driver can own multiple vehicles; each vehicle has independent verification and each new parcel assignment records the exact active, verified vehicle chosen by its driver. Existing assignments remain readable with `vehicle: null` until naturally completed; they are not backfilled with guessed vehicle IDs.


#### DRV-02 implementation contract

**Merged in backend PR #123.**

- Additive migration `20261108193000_drv_02_vehicle_assignment_binding` adds nullable vehicle references to direct parcel offers, delivery-leg offers and assignments.
- Drivers can list, register, update eligible unverified records and retire vehicles through owner-scoped APIs. New records are PENDING/inactive; verified vehicle identity is immutable; evidence-linked identity changes require a replacement record.
- Vehicle retirement is blocked while active parcel work is using the vehicle. Legacy active parcel assignments without a historical vehicle ID also block retirement. Retiring the last active verified vehicle forces the driver offline.
- A driver selects the vehicle when proposing a parcel or delivery-leg fare. For compatibility with the existing single-vehicle frontend, `vehicleId` may be omitted only when exactly one active verified vehicle exists; multiple active verified vehicles require explicit selection.
- Customer fare acceptance revalidates ownership, active state and verification for the exact selected vehicle, then persists it on the assignment.
- Existing assignments are not backfilled; their `vehicleId` remains null. Passenger rides retain their existing fare flow and do not inherit this parcel-specific vehicle requirement.
- Optional document expiry is captured through `X-Document-Expires-At`; past uploads and Admin approval of expired evidence are rejected. Runtime expiry blocking across dispatch and in-progress execution remains a DRV-05 gate.
- No production migration or deployment was performed.

### DRV-03 — Unified Admin Driver & Vehicle Operations workspace

**Goal:** Deliver one central dashboard for all drivers and vehicles.

- [x] Reuse the existing Admin driver-verification route as the unified workspace.
- [x] Integrate driver and vehicle review queues and linked detail panels.
- [x] Integrate capability and per-vehicle suitability review.
- [x] Integrate suspension/reinstatement and audit visibility.
- [x] Preserve backend Admin authorization and reason-required audited decisions.

**Status:** Frontend PR #50 merged. Remaining search/filter and pagination enhancements are tracked as follow-up Admin usability work, not a blocker for the DRV-05 dispatch gate.

### DRV-04 — Driver self-service workspace

**Goal:** Give every driver one coherent place to manage their operational profile.

- [x] Driver overview with approval/KYC state and clear next actions.
- [x] Capability request/status view.
- [x] Multi-vehicle list, registration, eligible edit and deactivation flows.
- [x] Document upload, review outcome and expiry metadata.
- [x] Service-area coverage visibility and availability control.
- [x] Assignment/opportunity links to existing parcel workflows.
- [x] Clear separation between profile approval, capability approval and vehicle approval.

**Status:** Frontend PR #51 merged at `707ef7995bf905a26b09c9cad731fcc8b1512c0a`. Staging acceptance remains outstanding.

### DRV-05 — Dispatch and assignment eligibility integration

**Goal:** Ensure the new capability model actually governs operational matching.

- [x] Apply capability + vehicle suitability checks to local dispatch opportunities.
- [x] Apply capability + vehicle suitability checks to pickup and final-mile matching, fare proposal and reservation.
- [x] Revalidate active country/state/zone and time-bounded service availability during delivery-leg offer creation and fare acceptance.
- [x] Use the shared configured driver-location freshness limit consistently across legacy and delivery-leg dispatch and reservation.
- [ ] Apply route/corridor + vehicle capacity checks to inter-state transport.
- [ ] Apply hub/transfer authorization to hub-transfer assignments.
- [ ] Re-check eligibility at offer, acceptance/reservation and execution boundaries where state can change.
- [ ] Reject stale, suspended, unverified or incompatible driver/vehicle combinations with stable domain error codes.
- [ ] Preserve current availability, location freshness, active-assignment concurrency and custody invariants.
- [ ] Do not auto-enable availability after assignment completion.

**DRV-05A status:** implemented on the current backend review branch; see [DRV-05A implementation notes](./driver-dispatch-drv-05a.md). Candidate matching, proposal and reservation gates are implemented. Execution-transition revalidation and staging acceptance are not complete.

### DRV-06 — Reporting, audit and operational controls

**Goal:** Make driver and fleet operations observable and accountable.

- [ ] Audit all capability and vehicle status transitions with actor, timestamp and reason.
- [ ] Provide filters/counts for pending reviews, approved capability mix, vehicle classes and inactive/expiring evidence.
- [ ] Record suspension/revocation effects on active offers and future eligibility.
- [ ] Provide assignment usage/history per driver and vehicle.
- [ ] Avoid exposing private identity documents in exports or broad list endpoints.

**Acceptance:** Admin can reconstruct who approved or changed a driver/vehicle and why; metrics use server-authoritative data.

### DRV-07 — Cross-role acceptance and release

**Goal:** Verify complete journeys and operational boundaries.

- [ ] Customer creates a local parcel booking; only eligible local-dispatch drivers/vehicles can be matched.
- [ ] Pickup and final-mile capabilities are independently checked.
- [ ] Inter-state assignment requires approved corridor capability and suitable vehicle.
- [ ] Hub-transfer work requires the relevant authorization and preserves two-party custody.
- [ ] A driver with multiple vehicles can select only an eligible active vehicle where selection is part of the contract.
- [ ] Vehicle deactivation/suspension blocks new work without corrupting historical assignments.
- [ ] Admin, driver and customer views remain correctly scoped.
- [ ] STRICT production KYC and TEST staging restrictions are verified.
- [ ] Typecheck, tests, build, API contract checks and CI pass on current PR heads.
- [ ] Staging acceptance is recorded separately from merged-code status.

**Acceptance:** end-to-end evidence covers each role, service capability, vehicle class, failure state and authorization boundary.

## 5. Non-goals and hard boundaries

- **No passenger ride-hailing implementation in this workstream.** Rides remains a separate domain audit and delivery sequence.
- **No duplicate driver accounts or one-account-per-service design.**
- **No separate Admin dashboard per vehicle type or service category.**
- **No self-approval:** a driver may request capabilities and register vehicles; only authorized Admin review grants eligibility.
- **No implicit capability grants** during migration, seeding, profile creation or vehicle registration.
- **No automatic service coverage:** geography reference records do not imply active service-zone coverage.
- **No invented prices or direct driver price negotiation changes.** Existing pricing and partner agreement rules remain authoritative.
- **No live payment checkout or external payouts.** Existing payment and payout gates remain unchanged.
- **No shortcut around KYC, document privacy, assignment concurrency or custody controls.**

## 6. Definition of done

A phase is complete only when:

- [ ] The backend contract, authorization and persistence behavior are verified.
- [ ] Migrations preserve existing data and do not grant unreviewed capabilities.
- [ ] API/UI tests cover success, denial, conflict, duplicate and lifecycle-change paths.
- [ ] Driver capability, vehicle suitability, KYC tier and platform role remain distinct.
- [ ] Lists are paginated and scoped; sensitive evidence is private.
- [ ] UI includes loading, empty, error and permission states.
- [ ] Typecheck, configured lint, tests, API contract validation and production build pass.
- [ ] CI passes on the current PR head; stale runs do not count.
- [ ] README/status docs are updated with merged versus unverified status.
- [ ] Staging acceptance is recorded separately from code merge.

## 7. Repository workflow

1. Work in a dedicated branch and keep PRs focused.
2. Audit source and API contracts before implementation.
3. Backend schema/API/tests precede dependent frontend work.
4. Do not merge to `main` without explicit repository-owner approval.
5. Do not apply production migrations or alter production KYC/payment configuration without explicit approval.
6. Do not mark a phase complete based solely on a page, route, type or green build.
7. After each merge, reconcile both repositories and update this plan before starting the next phase.

## 8. Immediate next step

Start with **DRV-00**. Re-audit the current default branches and any open DRV PRs, then produce the exact gap matrix for the unified Admin workspace, capability model and multi-vehicle lifecycle. Do not start by creating new Prisma tables: first prove that existing driver/vehicle structures cannot represent the required relationships.

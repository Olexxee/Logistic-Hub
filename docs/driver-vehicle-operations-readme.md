# Driver & Vehicle Operations — Product and Implementation README

**Workstream:** DRV  
**Repositories:** [Logistic Hub backend](https://github.com/Olexxee/Logistic-Hub) · [Logistic Hub frontend](https://github.com/Olexxee/logistic-frontend)  
**Status:** Planning and source-reconciliation baseline. This document does not claim the new unified Admin workspace or multi-role vehicle management is implemented.

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
- **INTER_STATE_TRANSPORT** — carry parcels on an approved inter-state route/corridor.
- **HUB_TRANSFER** — move parcels between approved hubs or transfer points.

These are operational capabilities, not global authentication roles. Backend authorization continues to use the existing user role and ownership model. An Admin selecting a capability does not turn a user into an Admin, partner or hub operator.

Passenger rides remain a separate product/domain. Do not include PASSENGER_RIDE in the first release of this workstream or infer ride eligibility from parcel capabilities. Existing TEST_LIMITED KYC restrictions continue to block passenger-ride offers.

### 2.2 One vehicle registry; multiple vehicle classes

All vehicles are managed in the same registry and the same Admin workspace. Vehicle class is data, not a separate dashboard or account type.

Initial vehicle classes:

- **BICYCLE** — pedal bicycle.
- **MOTORCYCLE** — motorbike / dispatch motorcycle.
- **CAR** — eligible car.
- **VAN** — delivery van.
- **PICKUP_TRUCK** — pickup truck.
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

Create one Admin entry point, provisionally **/admin/driver-operations**, with a shared directory and linked detail views.

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

## 4. Work breakdown and delivery sequence

Each phase should be a focused PR or a small set of reviewable PRs. Backend/API contracts and tests lead; frontend consumes only verified contracts. Keep rides separate. Update this document and the relevant implementation-status documents after each merged phase.

### DRV-00 — Source audit and acceptance baseline

**Goal:** Establish exactly what exists before changing the schema or UI.

- [ ] Inspect Prisma driver, vehicle, document, service-zone, assignment and audit models.
- [ ] Inventory mounted driver/vehicle Admin and self-service routes, validators, services and repository methods.
- [ ] Reconcile OpenAPI and frontend contract-readiness against actual mounted routes.
- [ ] Inventory frontend driver pages, Admin navigation, query keys, API modules and permissions.
- [ ] Record current single-vehicle/multiple-vehicle constraints and any existing service/capability fields.
- [ ] Identify missing list/detail/filter/review endpoints and existing tests.
- [ ] Produce a source-backed gap matrix; no schema migration or UI rewrite in this phase.

**Acceptance:** every planned mutation and screen maps to an existing verified contract or a specifically identified backend change.

### DRV-01 — Domain model and backend capability contracts

**Goal:** Represent driver capabilities and vehicle service suitability without conflating them with platform roles.

- [ ] Decide whether existing fields/tables already model service capabilities; reuse them if semantically correct.
- [ ] If absent, define normalized, auditable driver-capability records with statuses such as REQUESTED, APPROVED, REJECTED, SUSPENDED and REVOKED.
- [ ] Define vehicle class and per-vehicle approved service suitability.
- [ ] Support one driver with multiple vehicles and multiple approved capabilities.
- [ ] Preserve existing driver/vehicle records through additive migrations and explicit backfill; never silently grant capabilities to existing profiles.
- [ ] Add Admin review/revocation endpoints with reason, actor and audit event.
- [ ] Add owner-scoped driver self-service read/request/update endpoints as appropriate.
- [ ] Define eligibility response/reason codes for dispatch and assignment consumers.
- [ ] Update OpenAPI, API readiness documentation and seed/test fixtures.

**Acceptance:** API tests prove that requesting or approving one capability does not grant others, and no client-supplied field can self-approve a driver or vehicle.

### DRV-02 — Vehicle registration and verification lifecycle

**Goal:** Complete the multi-vehicle lifecycle, including motorcycles and bicycles.

- [ ] Register another vehicle for an existing driver.
- [ ] Edit permitted vehicle metadata without overwriting reviewed evidence.
- [ ] Replace, deactivate or retire a vehicle with assignment-safety checks.
- [ ] Capture class-specific registration identifiers and document requirements.
- [ ] Support vehicle-specific documents, review decisions, expiry metadata and renewal status.
- [ ] Enforce class-aware rules: bicycle registration/license requirements must not be copied from motorized vehicles; motorized vehicle requirements must follow approved compliance policy.
- [ ] Prevent unverified, suspended, expired or retired vehicles from new assignments.
- [ ] Preserve historical assignment and audit references when a vehicle is deactivated or replaced.

**Acceptance:** a driver can own multiple vehicles; each vehicle has independent verification and only eligible vehicles appear for matching/assignment.

### DRV-03 — Unified Admin Driver & Vehicle Operations workspace

**Goal:** Deliver one central dashboard for all drivers and vehicles.

- [ ] Add a single Admin route/navigation entry.
- [ ] Build server-paginated driver and vehicle directories with search, status, capability, vehicle class and service-area filters.
- [ ] Build linked driver and vehicle detail panels/pages.
- [ ] Add review queues for applications, capabilities, vehicles and documents.
- [ ] Add reason-required approve/reject/suspend/reactivate/revoke actions.
- [ ] Display verification tier separately from verification status.
- [ ] Show driver capabilities separately from vehicle suitability.
- [ ] Show eligibility explanations (e.g. capability missing, vehicle unverified, inactive zone, stale location).
- [ ] Apply Admin authorization in the backend; frontend permission checks are presentation only.
- [ ] Provide loading, empty, error, forbidden, conflict and success states; support mobile/tablet/desktop.

**Acceptance:** an Admin can locate any driver or vehicle from the same workspace, inspect their relationship and make only authorized, audited decisions.

### DRV-04 — Driver self-service workspace

**Goal:** Give every driver one coherent place to manage their operational profile.

- [ ] Driver overview with approval/KYC state and clear next actions.
- [ ] Capability request/status view.
- [ ] Vehicle list with add/edit/replace/deactivate flows.
- [ ] Document upload, review outcome and expiry/renewal state.
- [ ] Service-area coverage and availability controls.
- [ ] Assignment/opportunity links to existing parcel workflows.
- [ ] Clear separation between profile approval, capability approval and vehicle approval.

**Acceptance:** a driver can understand exactly which services and vehicles are approved without being able to self-grant eligibility.

### DRV-05 — Dispatch and assignment eligibility integration

**Goal:** Ensure the new capability model actually governs operational matching.

- [ ] Apply capability + vehicle suitability checks to local dispatch opportunities.
- [ ] Apply capability + vehicle suitability checks to pickup and final-mile assignments.
- [ ] Apply route/corridor + vehicle capacity checks to inter-state transport.
- [ ] Apply hub/transfer authorization to hub-transfer assignments.
- [ ] Re-check eligibility at offer, acceptance/reservation and execution boundaries where state can change.
- [ ] Reject stale, suspended, unverified or incompatible driver/vehicle combinations with stable domain error codes.
- [ ] Preserve current availability, location freshness, active-assignment concurrency and custody invariants.
- [ ] Do not auto-enable availability after assignment completion.

**Acceptance:** API/integration tests prove an ineligible driver or vehicle cannot receive, accept or execute an assignment, including race/state-change cases.

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

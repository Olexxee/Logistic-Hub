# AH-5 — Partner & Geography Contract Audit

**Workstream:** Admin & Hub Management (AH-5)  
**Slice:** AH-5.0 — Contract audit and integration readiness  
**Audited ref:** main  
**Audit date:** 1 November 2026  
**Status:** Source audit complete; no runtime changes or schema migrations in this slice.

## Purpose and decision

This document records the source-verified backend contract for transport partners, partner memberships, agreements, rate cards, geography, service zones and hub relationships. It is the implementation gate for AH-5.1–AH-5.6.

**Decision:** the backend has meaningful write and lifecycle foundations, but AH-5 is not fully frontend-ready. In particular, partner membership and commercial-record read endpoints are missing, and partner/hub lifecycle synchronization is incomplete. Frontend work must not invent these contracts.

## 1. Route mounting

The relevant routers are mounted in src/app.js:

| Router | Mount |
|---|---|
| Geography admin | /api/v1/geography/admin |
| Service zones | /api/v1/service-zones |
| Hub points | /api/v1/hub-points |
| Hub applications | /api/v1 |
| Partner pricing | /api/v1 |
| Partner execution | /api/v1 |

The endpoints below are absolute paths after applying those mounts.

## 2. Transport partner management

### Confirmed ADMIN endpoints

| Method | Endpoint | Contract |
|---|---|---|
| GET | /api/v1/admin/transport-partners | Paginated directory; filters by search, status and verification status; includes agreement/member/hub counts. |
| POST | /api/v1/admin/transport-partners | Creates a partner from display name and optional legal/contact fields. |
| GET | /api/v1/admin/transport-partners/:partnerId | Returns partner profile and aggregate counts. |
| PATCH | /api/v1/admin/transport-partners/:partnerId | Updates display/legal/contact fields with mandatory reason and before/after audit. |
| PATCH | /api/v1/admin/transport-partners/:partnerId/status | Changes partner status and optionally verification status; mandatory reason is audited. |

All partner administration routes are protected by authentication and ADMIN role middleware.

### Existing lifecycle rules

- Partner status values: PENDING, ACTIVE, SUSPENDED, CLOSED.
- Verification values: NOT_SUBMITTED, PENDING, VERIFIED, REJECTED, EXPIRED.
- Activation requires VERIFIED status and at least one active, verified OWNER membership.
- Suspending a partner is blocked while it has active partner assignments. On successful suspension, its active agreements are suspended in the same transaction and audited.
- Closing a partner is blocked while it has active members, open agreements or unsettled payables.
- A CLOSED partner cannot be reopened.
- Partner status and verification changes require a decision reason, which is persisted on the audit event.

### Gaps

- The partner detail response intentionally exposes aggregate counts, not member rosters or commercial history; those remain separate AH-5.2/AH-5.3 read contracts.
- Directory search currently matches display name, legal name, contact name and contact email. It does not search arbitrary metadata.

**AH-5.1 implication:** the backend partner directory/detail/profile/status contract is now implemented. A frontend workspace can consume these endpoints without inventing partner read/update contracts.

## 3. Partner membership administration

### Confirmed ADMIN endpoints

| Method | Endpoint | Contract |
|---|---|---|
| GET | /api/v1/admin/transport-partners/:partnerId/members | Paginated partner roster; supports search, role and active-status filters. |
| POST | /api/v1/admin/transport-partners/:partnerId/members | Adds or reactivates an eligible user with role OWNER, OPERATIONS or DISPATCHER; requires a reason. |
| PATCH | /api/v1/admin/transport-partners/:partnerId/members/:memberId | Updates role and/or active status; requires a reason. |

The roster defaults to page 1 and limit 20, with a maximum limit of 100. Search matches member full name, email and phone. The response includes membership ID, partner/user IDs, partner-scoped role, active status, membership timestamps and a restricted user profile (name, email, phone, global account role/status and email-verification timestamp). It does not expose password hashes, auth sessions, tokens or credentials.

Membership writes run in serializable transactions and emit an operational audit event in the same transaction. Each successful mutation records the actor, reason, action and before/after partner ID, user ID, role and active status. An unchanged request returns the current membership without creating a duplicate mutation event.

Only ACTIVE, email-verified user accounts can be added or reactivated. A CLOSED partner cannot receive or change memberships. For ACTIVE partners, adding/reactivating a non-OWNER or demoting/deactivating the last active verified OWNER is rejected with LAST_ACTIVE_OWNER. Reactivation through either POST or PATCH re-checks account eligibility. The partner-scoped PartnerMemberRole remains separate from global User.role; membership operations do not elevate or demote platform privileges.

### Remaining gaps

- No dedicated per-member event-history endpoint exists. Administrators can use the shared ADMIN audit-event stream, filtered by entity type TRANSPORT_PARTNER_MEMBER and the membership entity ID.
- There is no hard-delete membership endpoint; deactivation preserves the membership row and its audit history by design.

The ADMIN roster contract is sufficient to build a paginated partner-member workspace. Do not substitute GET /api/v1/partner/memberships/mine, which returns only the authenticated user's own memberships.

## 4. Partner agreements and rate cards

### Confirmed ADMIN mutation endpoints

| Method | Endpoint | Contract |
|---|---|---|
| GET | /api/v1/admin/transport-partners/:partnerId/agreements | Paginated ADMIN agreement list; supports page, limit, reference search and status filter. |
| POST | /api/v1/admin/transport-partners/:partnerId/agreements | Creates a DRAFT agreement with reference, currency, effective dates and optional commercial terms. |
| GET | /api/v1/admin/partner-agreements/:agreementId | Returns agreement detail, partner eligibility/status, versioned rate-card summaries and aggregate counts. |
| POST | /api/v1/admin/partner-agreements/:agreementId/activate | Activates an eligible DRAFT agreement; requires an audit reason. |
| PATCH | /api/v1/admin/partner-agreements/:agreementId/status | Suspends, expires or terminates an agreement; ACTIVE must use the activation route. Requires an audit reason. |
| GET | /api/v1/admin/partner-agreements/:agreementId/rate-cards | Paginated rate-card version list with status filters and active-rate counts. |
| POST | /api/v1/admin/partner-agreements/:agreementId/rate-cards | Creates the next version as a DRAFT rate card. |
| GET | /api/v1/admin/partner-rate-cards/:rateCardId | Returns a rate-card version and its route rates, zone names/statuses, constraints and minor-unit charge strings. |
| POST | /api/v1/admin/partner-rate-cards/:rateCardId/rates | Adds a rate to a DRAFT rate card. |
| POST | /api/v1/admin/partner-rate-cards/:rateCardId/publish | Publishes an eligible DRAFT rate card and retires the prior ACTIVE card for that agreement; requires an audit reason. |

These routes are mounted under the partner-pricing router, which applies authentication and ADMIN authorization router-wide.

### Existing business rules

- One ACTIVE agreement per partner is enforced during activation.
- Agreement activation requires an ACTIVE, VERIFIED partner and an effective date window that includes the current time.
- An ACTIVE agreement cannot be suspended/terminated while it has active partner assignments.
- Rate-card versions are incremented per agreement.
- Rates reference origin and destination service-zone IDs, service type, parcel category, weight/dimension limits, integer minor-unit transport charge and optional transit estimate.
- Both route service zones must exist and be active when a rate is added.
- A rate card can be published only when its agreement and partner are eligible, its effective window is current and it has at least one active rate.
- Publishing retires the previously ACTIVE rate card for that agreement.
- Partner suspension suspends active agreements. The status transition and dependent agreement events are transactional and audited.

### Gaps

- No ADMIN list/detail endpoints for agreements.
- No ADMIN list/detail endpoints for rate cards or their rates.
- No edit/deactivate/delete endpoint for an individual rate. A published card is immutable through the current admin routes; a new version is the supported path.
- Agreement/rate-card status mutations do not accept a mandatory reason.
- No read API contract exposes the full commercial history needed for a partner detail workspace.

**Pricing rule:** partner rate cards are negotiated commercial inputs, not customer prices. Do not seed invented transport prices or let the UI calculate a quote from distance alone. Quote selection must continue to consume eligible published rates and preserve the accepted quote snapshot.

## 5. Hub application and partner ownership

The current backend DOES contain a HubApplication model and a mounted hub-application router. The older AH-0 audit text that states no HubApplication model exists describes an earlier baseline and is superseded by this source-verified finding.

### Confirmed endpoints

| Method | Endpoint | Access |
|---|---|---|
| POST | /api/v1/partner/hub-applications | Authenticated partner OWNER |
| GET | /api/v1/partner/hub-applications | Authenticated applicant; own applications only |
| POST | /api/v1/partner/hub-applications/:applicationId/withdraw | Owning applicant; PENDING only |
| GET | /api/v1/admin/hub-applications | ADMIN |
| POST | /api/v1/admin/hub-applications/:applicationId/approve | ADMIN; mandatory reason |
| POST | /api/v1/admin/hub-applications/:applicationId/reject | ADMIN; mandatory reason |

Application submission requires an active, email-verified applicant; active OWNER membership in the specified transport partner; an ACTIVE, VERIFIED partner; an active service zone and active parent state/country; hub name/address/coordinates, operator contact, opening hours, accepted parcel types and capacity configuration.

Application statuses include PENDING, APPROVED, REJECTED and WITHDRAWN. Duplicate pending applications for the same partner, zone and case-insensitive name are returned as a replay.

Approval creates a partner-owned HubPoint in PENDING, creates/activates a MANAGER membership for the applicant and records reviewer/audit details. Approval does not activate the hub. Hub activation is a separate ADMIN operation with its own manager, geography, parcel-availability and operational-readiness checks.

### Direct ADMIN hub creation

POST /api/v1/hub-points/admin also supports optional partnerId. When supplied, the partner must already be ACTIVE and VERIFIED. The HubPoint.partnerId relationship is persisted. Updates intentionally do not allow changing partnerId.

This means the data model can distinguish partner-linked hubs from hubs without a partner link, but it does not yet define a richer organization/ownership taxonomy for every possible hub operator type.

## 6. Geography administration

All geography admin routes are authenticated and ADMIN-only.

| Method | Endpoint | Contract |
|---|---|---|
| GET/POST | /api/v1/geography/admin/countries | List/create countries. |
| PATCH | /api/v1/geography/admin/countries/:id | Update country code/name. |
| PATCH | /api/v1/geography/admin/countries/:id/status | Activate/deactivate country. |
| GET/POST | /api/v1/geography/admin/states | List/create states; list can filter by countryId. |
| PATCH | /api/v1/geography/admin/states/:id | Update state code/name. |
| PATCH | /api/v1/geography/admin/states/:id/status | Activate/deactivate state. |
| GET/POST | /api/v1/geography/admin/lgas | List/create LGAs; list can filter by stateId. |
| PATCH | /api/v1/geography/admin/lgas/:id | Update LGA code/name. |
| DELETE | /api/v1/geography/admin/lgas/:id | Delete only when no service zones reference the LGA. |

Hierarchy safeguards:
- A state can only be created under an existing active country.
- An LGA can only be created under an existing active state and country.
- A country cannot be deactivated while it has active states.
- A state cannot be deactivated while it has active service zones.
- A state cannot be activated under an inactive country.
- An LGA referenced by a service zone cannot be deleted.

### Gaps and data caveats

- No bulk import or canonical Nigeria geography seed is established by these CRUD routes.
- Country/state deletion endpoints are not exposed.
- No dedicated geography change-history read endpoint exists beyond the shared ADMIN audit stream.
- Do not assume the database currently contains all 36 states, FCT and 774 LGAs merely because the model supports the hierarchy. Verify seeded records before declaring national coverage.

## 7. Service zones and availability

### Confirmed ADMIN endpoints

| Method | Endpoint | Contract |
|---|---|---|
| GET | /api/v1/service-zones/admin | Lists zones with state/country, LGA and service availability. |
| POST | /api/v1/service-zones/admin | Creates a zone under an active state; optional LGA must belong to that state. |
| PATCH | /api/v1/service-zones/admin/:serviceZoneId | Updates zone name/code/LGA/boundary GeoJSON. |
| PATCH | /api/v1/service-zones/admin/:serviceZoneId/status | Activates/deactivates a zone. |
| PUT | /api/v1/service-zones/admin/:serviceZoneId/availability | Upserts availability by service type, with enabled flag, effective dates and config. |

Existing safeguards:
- A zone can only be created under active geography.
- An LGA selected for a zone must belong to the same state.
- Changing a zone's LGA or deactivating a zone is blocked while active hubs use it.
- Availability cannot be enabled under inactive geography.
- Parcel-delivery availability cannot be disabled/scheduled out of its effective window while active hubs remain.
- Mutations write operational audit events with before/after snapshots.

### Gaps and caveats

- The admin list does not include hub counts or a hub roster.
- boundaryGeoJson is stored as a generic JSON object; this contract does not establish geometry validation, coordinate normalization or point-in-polygon enforcement.
- Do not label this feature as geofencing or claim that booking coordinates are rejected outside a polygon unless a separate enforcement path is verified.
- Availability is modeled per service type with an enabled flag, effective dates and opaque config. Do not invent a weekday/time-window schema beyond the actual config contract.

## 8. Cross-resource integration findings

### Implemented

- Partner-linked hubs persist partnerId; partner application approval creates the hub with the application partner.
- Partner status suspension suspends active partner agreements in the same transaction.
- Agreement/rate-card eligibility checks require active/verified partner and valid agreement/card effective dates.
- Hub activation requires active geography, active parcel availability, an active verified manager and complete operational details.
- Hub/service-zone and geography parent-child mutations protect active dependent resources.

### AH-5.6 lifecycle policy and implementation

**Implemented on `feat/ah-5-6-partner-hub-lifecycle-sync`; pending CI and merge.**

- When a partner transitions to SUSPENDED or CLOSED, every partner-owned ACTIVE hub is changed to SUSPENDED in the same serializable transaction as the partner/agreement transition.
- Each affected hub receives its own `HUB_SUSPENDED_WITH_PARTNER` operational audit event, including actor, reason, partner ID and before/after status.
- A partner-owned hub can transition to ACTIVE only when its owning partner is currently ACTIVE and VERIFIED.
- Reactivating a partner does not automatically reactivate its hubs. Hub reactivation remains a separate ADMIN decision and continues to require active verified hub management, service-zone availability and complete operational details.
- Existing delivery legs, custody records and hub history are not deleted or rewritten. Existing partner assignment safeguards remain in force before partner suspension/closure.

This prevents a suspended or closed partner from retaining operationally active hubs without silently changing historical shipment or custody records.

### Other integration gaps

- There is no single admin read model joining partner, members, agreements, hubs and service coverage.
- No ADMIN member/agreement/rate-card read endpoints exist for full detail screens.
- Hub/partner membership and commercial mutation audit reasons are inconsistent or absent. The shared audit history is not a substitute for missing decision context.

## AH-5.1 implementation update

AH-5.1 adds the following ADMIN partner-management contracts:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/v1/admin/transport-partners | Paginated directory; supports page, limit, search, status and verificationStatus filters. |
| GET | /api/v1/admin/transport-partners/:partnerId | Partner profile with aggregate agreement, member, hub and delivery-assignment counts. |
| PATCH | /api/v1/admin/transport-partners/:partnerId | Updates display/legal/contact profile fields; requires a reason and records before/after values. |
| PATCH | /api/v1/admin/transport-partners/:partnerId/status | Status/verification decision now requires a reason recorded on the partner audit event and any dependent agreement-suspension audit events. |

Directory defaults are page 1 and limit 20; maximum limit is 100. Search matches display name, legal name, contact name and contact email case-insensitively. The response includes total and totalPages metadata.

Closed partners cannot have their profile changed. Existing partner status-transition guards remain in place, including active verified OWNER requirement, active assignment protection, agreement suspension on partner suspension, and close-out checks for members, agreements and unsettled payables.

AH-5.2 partner membership administration is merged. AH-5.3 adds the agreement/rate-card history read contracts and reasoned lifecycle decisions described below. Partner suspension does not yet synchronize partner-owned hub status; that remains AH-5.6.

## 9. AH-5 slice readiness

| Slice | Current readiness | Required work before/during implementation |
|---|---|---|
| AH-5.0 Contract audit | Complete | Source-verified gaps recorded in this document. |
| AH-5.1 Partner management | Merged | Directory filters/pagination, detail, reasoned profile update and reasoned status/verification decisions. |
| AH-5.2 Partner memberships | Merged | ADMIN roster with pagination/search/role/status filters; reasoned add/reactivate/role-change/deactivation; full before/after audit; last active OWNER and account eligibility safeguards. |
| AH-5.3 Agreements/rate cards | Merged | ADMIN agreement/card list and detail reads; route-rate detail and minor-unit serialization; reasoned lifecycle decisions and immutable published versions. |
| AH-5.4 Google Maps location integration | Merged | Authenticated Nigeria-restricted Places Autocomplete, selected-place details and geocoding; no database migration or address-processing job. |
| AH-5.5 Service zones | Frontend work outstanding | Build service-zone and service-availability administration UI against existing CRUD/availability contracts; do not claim polygon geofencing. |
| AH-5.6 Cross-resource integration | Implemented on feature branch; CI/merge pending | Synchronize partner suspension/closure with partner-owned active hubs; enforce partner eligibility on hub activation; audit all dependent transitions. |

## 10. Validation and scope

AH-5.0 was documentation-only and introduced no runtime or schema changes. AH-5.1 and AH-5.2 add partner administration and membership read/update routes with audit behavior. AH-5.3 adds commercial history read routes and reasoned lifecycle audit behavior. These slices introduce no Prisma schema changes or migrations and do not alter quote calculation, customer prices, payments, refunds, partner settlement, production data or geography imports.

The AH-5.0 source audit was performed against router mounts, route validators/controllers/services/repositories and Prisma model relationships. AH-5.1 adds route tests, PostgreSQL-gated integration coverage and OpenAPI parity validation; passing CI is still required before merge.

## 11. Recommended implementation order

1. **AH-5.1:** partner directory, detail, profile and lifecycle administration API completed; frontend workspace can now be implemented against the published contracts.
2. **AH-5.2:** partner member roster and reasoned membership lifecycle API; frontend membership UI can follow after this slice merges.
3. **AH-5.3:** agreement/rate-card read endpoints, then versioned commercial administration.
4. **AH-5.4:** Google Maps address discovery, selected-place details and Nigeria-restricted geocoding; frontend address-selection consumers follow the backend contract.
5. **AH-5.5:** service-zone and availability administration UI against the existing backend contracts.
6. **AH-5.6:** partner/hub lifecycle synchronization and regression tests before treating integrated operations as complete.

Do not implement all missing endpoints speculatively in AH-5.0. Each backend change should be a scoped implementation slice with route/service tests and OpenAPI parity.

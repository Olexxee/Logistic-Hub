# Admin & Hub Management — Backend Contract Audit

**Workstream:** AH-0  
**Status:** Source audit in progress; no runtime/schema changes in this slice.  
**Audited baseline:** `main`, 1 November 2026  
**Implementation branch:** `feat/admin-hub-management-audit`

## Purpose

Establish the real backend contract and authorization boundaries before implementing the Admin & Hub Management frontend or changing backend behavior. This document records source-verified behavior. Product requirements that the backend does not yet support are explicitly marked as gaps.

## Executive findings

1. The backend already supports an ADMIN user directory, admin-created hub points, hub operator memberships, hub lifecycle controls, partner memberships, partner administration, geography/service-zone administration and operational audit history.
2. Hub operator administration is implemented in `custody.routes.js`, not `hub-points.routes.js`. The older route inventory has the correct absolute paths but its module attribution is incomplete.
3. The platform has no global `OWNER` role. `OWNER` is a `PartnerMemberRole`, scoped to a transport partner. Hub roles are scoped separately as `MANAGER` and `OPERATOR`.
4. Membership mutation currently changes the user's global role. This is unsafe coupling: organization membership should not be the source of platform identity or authorization.
5. There is no `HubApplication` model or hub-to-owning-organization relation in the audited schema. The current hub record cannot reliably distinguish company-operated from partner-operated ownership, and the public representative application workflow is not present in the inspected routes.
6. Hub status is `PENDING | ACTIVE | SUSPENDED | CLOSED`. There is no separate application approval state. Activation is nevertheless gated by an active, verified manager membership, active geography and parcel availability, verified operator details, opening hours, accepted parcel types and capacity configuration.
7. Persisted sessions and request-time session checks exist. The admin-facing session revocation workflow is not implemented; the available `/auth/sessions/revoke-all` endpoint is authenticated self-service.
8. Audit writes exist for hub, partner and membership mutations. Audit payload consistency is not yet equivalent to a universal before/after/reason policy; some membership events record only status changes, and some omit a reason.

## 1. Repository and route mounting

The application mounts these relevant routers in `src/app.js`:

| Router | Mount |
|---|---|
| Discovery | `/api/v1` |
| Audit | `/api/v1/admin/audit-events` |
| Auth | `/api/v1/auth` |
| Auth sessions | `/api/v1/auth/sessions` |
| Geography admin | `/api/v1/geography/admin` |
| Service zones | `/api/v1/service-zones` |
| Hub points | `/api/v1/hub-points` |
| Custody (including hub operator administration) | `/api/v1` |
| Partner execution | `/api/v1` |
| Operations control | `/api/v1` |

### Confirmed administrative endpoints

| Capability | Absolute endpoint | Guard | Source |
|---|---|---|---|
| User directory | `GET /api/v1/admin/users` | Auth + ADMIN | `discovery.routes.js` |
| Hub directory | `GET /api/v1/hub-points/admin` | Auth + ADMIN | `hub-points.routes.js` |
| Create hub | `POST /api/v1/hub-points/admin` | Auth + ADMIN | `hub-points.routes.js` |
| Update hub | `PATCH /api/v1/hub-points/admin/:hubPointId` | Auth + ADMIN | `hub-points.routes.js` |
| Change hub status | `PATCH /api/v1/hub-points/admin/:hubPointId/status` | Auth + ADMIN | `hub-points.routes.js` |
| Review hub operator verification | `PATCH /api/v1/hub-points/admin/:hubPointId/operator-verification` | Auth + ADMIN | `hub-points.routes.js` |
| Add hub operator | `POST /api/v1/admin/hub-points/:hubPointId/operators` | Auth + ADMIN | `custody.routes.js` |
| Activate/deactivate hub operator membership | `PATCH /api/v1/admin/hub-points/:hubPointId/operators/:operatorId` | Auth + ADMIN | `custody.routes.js` |
| Add partner member | `POST /api/v1/admin/transport-partners/:partnerId/members` | Auth + ADMIN | `partner-execution.routes.js` |
| Activate/deactivate partner member | `PATCH /api/v1/admin/transport-partners/:partnerId/members/:memberId` | Auth + ADMIN | `partner-execution.routes.js` |
| Operations overview | `GET /api/v1/admin/operations/overview` | Auth + ADMIN | `operations-control.routes.js` |
| Audit history | `GET /api/v1/admin/audit-events` | Router-wide Auth + ADMIN | `audit.routes.js` |

The older `docs/admin-route-permission-inventory.md` lists the two hub-operator endpoints accurately, but attributes them generically to hub administration. The actual implementation is in the custody module. Do not add duplicate routes in the hub-points module.

### User directory contract

`GET /api/v1/admin/users` accepts:
- `q`: optional search string, 2–120 characters.
- `role`: one of the current `UserRole` values.
- `status`: one of `PENDING | ACTIVE | SUSPENDED | CLOSED`.
- `page`: positive integer, default 1.
- `limit`: 1–100, default 25.

It returns identity/contact fields, global role, account status, verification timestamps and creation timestamp with pagination. It is read-only. There is no verified admin endpoint in the audited routes to change a user's global role, suspend/reactivate an account, or revoke that user's sessions.

### Hub registration and lifecycle contract

Admin hub creation requires a service-zone ID, name, address and coordinates. Optional fields include operator contact details, opening hours, accepted parcel types and capacity configuration. The service creates the hub in `PENDING`.

Hub status transitions are constrained:
- `PENDING` → `PENDING | ACTIVE | SUSPENDED | CLOSED`
- `ACTIVE` → `ACTIVE | SUSPENDED | CLOSED`
- `SUSPENDED` → `SUSPENDED | ACTIVE | CLOSED`
- `CLOSED` → `CLOSED` only

Activation requires:
- at least one active, verified, email-verified hub manager membership;
- active country, state and service zone;
- currently enabled parcel-delivery availability for that zone;
- verified operator contact details;
- valid opening hours;
- at least one accepted parcel type; and
- valid capacity configuration.

Closure is blocked while there are non-terminal delivery legs, received/exception hub intakes, pending custody handovers or open operational cases. Closed hubs cannot be edited or reopened.

**Important distinction:** the backend's `PENDING` hub status is not a separate application-review record. It must not be presented as a fully featured application workflow with applicant, submitted evidence, reviewer decision and rejection reason.

## 2. Identity and role taxonomy

Current Prisma `UserRole` values:

- `CUSTOMER`
- `DRIVER`
- `HUB_OPERATOR`
- `PARTNER_OPERATOR`
- `SUPPORT`
- `ADMIN`

Scoped membership enums:

- `HubOperatorRole`: `MANAGER | OPERATOR`
- `PartnerMemberRole`: `OWNER | OPERATIONS | DISPATCHER`

There is no global `OWNER` role. The `OWNER` enum value belongs only to partner membership. It does not represent platform ownership or global administrative authority.

**Frontend mapping rule:** represent platform account role separately from each hub/partner membership role. A person may have memberships in multiple hubs and partners. Do not model a hub manager as a new global role such as `HUB_MANAGER`; use global `HUB_OPERATOR` plus the scoped `HubOperatorRole.MANAGER`.

## 3. Critical finding: membership/global-role coupling

The following behavior is directly implemented:

### Hub membership

`custody.service.js`:
- `addHubOperator` accepts users with global roles `CUSTOMER`, `HUB_OPERATOR` or `PARTNER_OPERATOR`.
- It upserts the scoped `HubPointOperator` membership.
- If the user's global role was `CUSTOMER`, it changes the global role to `HUB_OPERATOR`.
- `setHubOperatorStatus` deactivates membership and, if no active hub or partner memberships remain, changes a global `HUB_OPERATOR` or `PARTNER_OPERATOR` role back to `CUSTOMER`.

### Partner membership

`partner-execution.service.js`:
- `addMember` accepts users with global roles `CUSTOMER`, `PARTNER_OPERATOR` or `HUB_OPERATOR`.
- It upserts the scoped `TransportPartnerMember` membership.
- If the user's global role was `CUSTOMER`, it changes the global role to `PARTNER_OPERATOR`.
- `setMemberStatus` can change the global role back to `CUSTOMER` when no active hub or partner membership remains.

### Why this must be corrected before AH-1 role administration

A user can belong to multiple organizations and hold different scoped responsibilities. A membership change in one organization must not silently rewrite their platform identity. Global role mutation also makes authorization dependent on whichever membership was last added/removed. This can create inconsistent access when users hold both hub and partner memberships.

**Required design direction:** preserve the global role as a platform/account classification and authorize operational access through active, resource-scoped memberships and their scoped roles. Before changing this behavior, inventory every route that currently checks `HUB_OPERATOR` or `PARTNER_OPERATOR` globally and confirm that each operation also enforces the appropriate membership. This audit does not change runtime behavior.

## 4. Hub organization ownership and applications

The audited `HubPoint` schema contains operational hub data and a service-zone relation. It does not contain a clear owning-organization relation. The schema has no distinct `HubApplication` entity in the inspected model set.

Consequences:
- Company-operated and partner-business-operated hubs cannot be reliably distinguished by a normalized owning organization relation.
- A creator/applicant cannot be represented as the applicant of a reviewable application record.
- Application submission, review, rejection, resubmission and approval history cannot be represented independently of the hub's operational status.
- Direct admin creation exists, but it is not equivalent to a representative-submitted application.

Do not bolt an `organizationId` onto the frontend as if the API already returns it. AH-2 requires a backend domain decision: organization model/ownership types, applicant linkage, application lifecycle, evidence requirements and audit semantics. This likely requires schema and API changes, but should be designed before migration.

## 5. Session and account controls

The schema has persisted `AuthSession` records with user ID, token hash, expiry, revocation timestamp, last-used timestamp, user agent and IP hash.

The authentication middleware:
- verifies the bearer access token;
- reloads the current user and checks ACTIVE status and email verification;
- checks that the referenced persisted session exists, is not revoked and is not expired;
- attaches the current database role to the request.

The session service supports revoking one session, revoking the current session, and revoking all sessions for a user. The mounted `POST /api/v1/auth/sessions/revoke-all` route only revokes the authenticated user's own sessions. No ADMIN route to list another user's sessions or revoke all sessions for a target user was found in the audited routes.

A future admin account suspension endpoint must revoke all target-user sessions in the same transaction as the status change (or use a reliably atomic equivalent). Since middleware reloads user status on every request, suspended users are rejected even if an old access token remains cryptographically valid; session revocation is still required for explicit invalidation and defense in depth.

## 6. Audit coverage

### Existing foundations

- `OperationalAuditEvent` stores actor, entity type/ID, action, reason, before/after JSON and metadata.
- `writeOperationalAuditEvent` enforces actor identity for human events and explicit source metadata for system events.
- Request IDs are added to audit metadata through the request audit context.
- Admin-only audit history is mounted at `GET /api/v1/admin/audit-events`.
- Hub create/update/status/operator-verification and hub operator membership mutations write audit events.
- Partner membership activation/suspension writes audit events.

### Gaps to resolve before exposing administrative controls

- Hub and partner membership events do not consistently capture full before/after membership role, target user identity, and reason.
- Some membership mutation APIs accept no reason at all.
- The partner membership audit records global-role changes, which is another symptom of the role coupling described above.
- No admin user-role/status mutation endpoint was found, so there is no complete audit contract for those actions.
- No target-user session revocation admin workflow or associated audit event was found.
- The schema's operational audit event is useful for operational history, but do not assume it is a complete immutable administrative security log until retention, access, mutation/deletion protections and coverage are verified.

**Required mutation audit minimum:** actor ID, target resource and target user where relevant, action, before state, after state, reason for sensitive decisions, timestamp and request ID. Preserve existing operational events; do not create a parallel audit model without a demonstrated gap.

## 7. Authorization boundaries for hub operations

Hub operational routes in `custody.routes.js` are generally authenticated but not protected by a global role guard. Their security relies on service-level checks.

The custody service validates:
- hub is active and is an origin/destination hub for the delivery leg;
- actor has an active membership in the relevant hub;
- partner actors have active membership in the assigned, verified partner;
- driver actors have a verified driver profile and assignment on the leg;
- custody party IDs correspond to the booking/leg and the actor is authorized for the releasing party.

This is the correct general direction for resource-scoped access, but route and integration tests must verify every hub operation (intakes, handovers, dispatchable legs, exception reporting and decisions) rejects a user who has no membership or membership in a different hub. The route's optional `hubPointId` filter must never be treated as authorization by itself.

The current `HubOperatorRole` distinction is not fully visible in the excerpted party validation for custody: `validateParty` checks active membership, but does not itself distinguish MANAGER from OPERATOR. Confirm which operations require manager authority and enforce that in service-level policy before adding UI affordances.

## 8. Existing test coverage and validation surface

Package scripts:
- `npm test`: Node test runner.
- `npm run api:validate`: OpenAPI and route-contract validation.
- `npm run db:validate`: Prisma schema validation.
- `npm run db:generate`: Prisma client generation.

Relevant tests visible in the repository include:
- `test/admin-route-permission-inventory.test.js`
- `test/auth-middleware.test.js`
- `test/auth-session-service.test.js`
- `test/auth-sessions-service.test.js`
- `test/audit.routes.test.js`
- `test/custody.controller.test.js`
- `test/custody.service.test.js`
- `test/hub-points-admin.routes.test.js`
- partner execution/pricing tests and the broader PostgreSQL-gated priority-3 authorization integration test.

The presence of service tests is not proof that all routes have authorization coverage. Add explicit tests for:
- ADMIN-only hub membership mutations and non-admin denial;
- manager-vs-operator authorization for each hub operation;
- cross-hub isolation and inactive membership denial;
- multi-hub and multi-partner membership role preservation;
- membership removal without global role mutation;
- account suspension plus target-session revocation;
- last active hub manager safeguards and concurrent membership changes;
- audit payload completeness for every privileged mutation.

This document-only AH-0 slice has not run CI or the repository test suite. Runtime changes and schema migrations are intentionally excluded.

## 9. Implementation decisions and sequence

| Slice | Scope | Gate |
|---|---|---|
| AH-0 | Contract, schema, route, authorization and audit audit | This document reviewed; route and role discrepancies resolved |
| AH-1 | Admin user management | Define account status actions, platform role semantics, session revocation, audit contract and safeguards first |
| AH-2 | Hub application/registration | Decide organization ownership and application domain before schema/API design |
| AH-3 | Hub membership management | Remove global-role coupling; define MANAGER/OPERATOR capability matrix and last-manager protections |
| AH-4 | Hub operational administration | Enforce per-hub scope and role-specific operations; preserve immutable history |
| AH-5 | Partner/geography integration | Reuse existing partner, agreement, geography and service-zone capabilities; avoid duplicate models |

### AH-1 must not assume

- A global OWNER role exists.
- `HUB_OPERATOR` means manager.
- `PARTNER_OPERATOR` means partner owner.
- Membership deactivation should demote a user to CUSTOMER.
- The user directory's current read-only contract supports account mutation.
- A hub's PENDING status is an application decision.
- Frontend route guards are security controls.

## 10. Explicit non-goals

This audit does not authorize or implement:
- live payment activation, checkout or payment initialization;
- provider refunds or external partner/bank payouts;
- changes to booking, delivery-leg, custody, settlement or pricing state machines;
- production migrations;
- global OWNER role creation;
- user-role mutation or account suspension endpoints;
- hub application/organization schema changes.

All backend behavior changes require a separately reviewed implementation slice and tests.


## AH-1 implementation delta — membership identity separation

**Implementation branch:** `feat/admin-membership-role-separation`

The first corrective implementation removes the coupling identified in Section 3:

- Adding a hub membership no longer changes `User.role`.
- Deactivating a hub membership no longer demotes a user to `CUSTOMER`.
- Adding a partner membership no longer changes `User.role`.
- Deactivating a partner membership no longer demotes a user to `CUSTOMER`.
- Membership assignment no longer rejects an otherwise active, email-verified user solely because their global role is not one of the former three operational roles. The global role and the scoped membership are now independent.
- Membership audit events record the membership's prior role/status and resulting role/status rather than a synthetic global-role transition.
- Obsolete `USER_ROLE_CONFLICT` response handling and the unused custody repository global-role mutation helper have been removed.

The audit's earlier statements describe the baseline at the time AH-0 was performed; this section records the subsequent AH-1 code change. This change does not remove the legacy `HUB_OPERATOR` or `PARTNER_OPERATOR` enum values. Their eventual deprecation requires a separate inventory of persisted user records, frontend assumptions and external integrations.

New service tests cover hub and partner membership activation/deactivation without global-role mutation. CI is the required validation gate before merge.


## AH-1 implementation delta — user account controls

**Implementation branch:** `feat/admin-user-management`

The following backend controls are now implemented in the AH-1 workstream:

- `GET /api/v1/admin/users` remains the safe paginated directory. Its `q` parameter is now correctly mapped to the repository's search filter.
- `PATCH /api/v1/admin/users/:userId/status` supports only `ACTIVE` → `SUSPENDED` and `SUSPENDED` → `ACTIVE`, with a mandatory reason.
- Suspending a user revokes all unexpired sessions in the same database transaction as the status update and audit event. Repeated suspension also cleans up any lingering unrevoked sessions.
- Reactivation requires an email-verified account. Reactivation does not recreate sessions; the user must authenticate again.
- `POST /api/v1/admin/users/:userId/sessions/revoke-all` revokes a target user's active sessions without changing account status. A reason is mandatory.
- Both mutation endpoints are ADMIN-only, reject self-targeting and protect ADMIN accounts from peer modification. Account status changes are audited with actor, target, before/after state and reason.
- Global platform-role mutation is deliberately not implemented. The backend has no platform OWNER authority, and allowing an ADMIN to grant or revoke ADMIN would violate the approved governance rule.

These endpoints do not close accounts, modify platform roles, or initiate payment/refund/payout operations. Operational consequences of suspending a driver or organization member still require dispatch/operations review; account suspension is an access-control action, not automatic reassignment of work.

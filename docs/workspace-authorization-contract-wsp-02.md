# Workspace Authorization Contract (WSP-02)

**Status:** Proposed implementation contract based on the accepted workspace decision  
**Date:** 9 November 2026  
**Scope:** Logistic Hub backend identity, role provisioning, memberships, API authorization and workspace resolution  
**Implementation status:** WSP-03B implements the canonical workspace resolver in the backend. The resolver is exposed by login and `GET /auth/me`; it does not replace resource-level authorization.

## 1. Governing decision

A user has exactly one **primary workspace**, represented by `User.role`. Operational memberships and capabilities are separate, resource-scoped entitlements. They do not silently change the primary workspace.

This distinction is mandatory:

- `User.role` answers: which workspace is this account assigned to?
- `TransportPartnerMember` answers: which transport partner(s) may this account operate for, and with which partner membership role?
- `HubPointOperator` answers: which hub point(s) may this account operate, and with which hub membership permissions?
- Driver profile, KYC, vehicle, capability, assignment and safety state answer: which driver actions are currently eligible?
- Account `User.status` answers: whether the identity itself may authenticate.

Do not add a second persisted workspace field while `User.role` already provides this single source of truth.

## 2. Primary workspace matrix

| `User.role` | Primary workspace | Required authorization context |
|---|---|---|
| `CUSTOMER` | Customer | Own customer records and customer capabilities |
| `DRIVER` | Driver | Driver profile; execution additionally requires verified profile, eligible vehicle/capability and exact assignment |
| `HUB_OPERATOR` | Hub | At least one active hub membership; every action scoped to the exact hub |
| `PARTNER_OPERATOR` | Partner | At least one active partner membership; every action scoped to the exact partner |
| `SUPPORT` | Support | Support queue and case permissions |
| `ADMIN` | Admin | Platform administration and operational oversight only |

Admin does not gain customer, driver execution, partner execution or hub custody privileges merely from being Admin. Admin-only oversight actions remain separately guarded.

## 3. Partner owner and hub membership rule

**A Transport Partner owner who manages one or more hubs remains in the Partner workspace.**

The existing hub application flow requires an active, verified transport partner and an active `OWNER` membership. Approval creates a pending hub and a `HubPointOperator` manager membership. That hub membership grants the owner scoped hub capabilities without changing `User.role`.

Consequences:

1. A Partner owner may have active memberships in multiple hubs associated with their partner, and remains `PARTNER_OPERATOR`.
2. A Partner owner must not access an unrelated hub merely because they own a transport partner.
3. A standalone hub operator whose primary operational responsibility is hub management may have `HUB_OPERATOR`, provided an active hub membership exists.
4. A person with both partner and hub memberships does not receive a workspace switcher. Their primary workspace remains the explicitly assigned `User.role`.
5. Removing or suspending one hub membership does not revoke unrelated partner membership or partner permissions.
6. Suspending a partner or hub must deny the affected resource scope without silently changing the account's primary role.

Do not equate “has a hub membership” with “is a Hub workspace account”.

## 4. Role assignment and transition

Membership creation is not role provisioning. Adding a partner or hub membership must never mutate `User.role` as an incidental side effect.

Primary-role transitions must be explicit, authorized and auditable:

- Driver: submitting the public driver application is explicit intent to enter the Driver workspace. The onboarding transaction must assign `DRIVER` at submission, not wait until verification approval. The pending/rejected profile controls what the user can do inside that workspace.
- Partner: assignment to `PARTNER_OPERATOR` is an explicit Admin-controlled provisioning action, backed by an active partner membership. Partner membership creation alone does not promote a Customer.
- Hub: assignment to `HUB_OPERATOR` is an explicit Admin-controlled provisioning action, backed by an active hub membership. A Partner owner remains `PARTNER_OPERATOR` when hub membership is granted.
- Support and Admin: provisioning is restricted to an authorized Admin-controlled process; no public or self-service elevation.
- Customer: a return to `CUSTOMER` is an explicit Admin-controlled conversion, not an automatic result of rejection, membership expiry, suspension, failed authorization or missing data.

An explicit transition must:
1. Validate the target role's required profile or active membership.
2. Reject transitions that would strand in-flight custody, assignments, financial obligations or unresolved operational work.
3. Preserve the same user identity, authentication history, bookings, memberships and audit history.
4. Record actor, previous role, next role, reason and relevant resource scope in an operational audit event.
5. Revoke or refresh sessions as required so stale client state cannot retain the former workspace.
6. Return a clear conflict when prerequisites are not met; never guess a role.

Do not implement a generic self-service role update endpoint.

## 5. Driver lifecycle and access gates

The current schema separates `User.status` from `DriverProfile.verificationStatus`. Keep those concerns separate.

| Driver profile state | Primary role | Workspace behavior |
|---|---|---|
| No application yet | Existing assigned role | Public driver application remains available; no Driver workspace yet |
| `PENDING` | `DRIVER` after submission | Driver application/status workspace only; no execution |
| `REJECTED` | `DRIVER` | Rejection/status and permitted reapplication flow; no execution |
| `VERIFIED` | `DRIVER` | Driver workspace; each operational action still checks profile, KYC, vehicle, capability, availability and assignment |
| Suspended driver profile | `DRIVER` | Restricted Driver workspace/status; no availability or execution actions |

Driver rejection and reapplication must not reset `User.role` to `CUSTOMER`. Approval must not be the first point at which the account becomes a Driver workspace account. The Driver profile status is the execution gate.

Account-level `User.status` remains an independent authentication gate. A suspended or closed user account must not authenticate simply because the driver profile is verified.

## 6. Resource authorization requirements

Every operational API must enforce both the primary workspace role and the resource-level entitlement required for the action. Role-only authorization is insufficient for multi-resource users; membership-only authorization is insufficient to enter another primary workspace.

### Driver
- Driver self-service documents, vehicles and capabilities require `DRIVER`.
- Driver execution routes require `DRIVER` plus the exact assignment ownership and current execution eligibility.
- Admin review/verification routes require `ADMIN`.
- Driver document download must prove either the requesting Driver owns the document or the requester has the appropriate Admin review permission.

### Partner
- Partner execution routes require `PARTNER_OPERATOR` and an active membership in the exact assignment's partner.
- Membership status, partner status and verification status are revalidated at execution boundaries.
- Admin membership management and partner assignment remain `ADMIN`-only.
- Partner members cannot enumerate or mutate another partner's work by changing a path/query identifier.

### Hub
- Hub operations require `HUB_OPERATOR` or the accepted Partner-owner capability path, plus an active membership in the exact hub.
- Hub manager/operator role and flags such as `canDispatch` remain scoped to that hub.
- Public hub discovery is not an operational workspace API.
- Admin hub creation, activation, verification and membership administration remain `ADMIN`-only.

### Support
- Authenticated users may create and view their own support tickets as a shared support capability; this does not grant access to the Support workspace.
- Ticket ownership is checked for messages and reads.
- `SUPPORT` and `ADMIN` may use the support queue and internal notes according to the existing Support contract.
- Ticket assignment is restricted to active `SUPPORT` or `ADMIN` accounts.

### Admin
- Admin routes must explicitly require `ADMIN`.
- Admin platform oversight does not implicitly grant operational execution rights.

## 7. Account state and fail-closed behavior

- `User.status` values `PENDING`, `SUSPENDED` and `CLOSED` do not receive an authenticated workspace.
- A pending or rejected operational profile may receive its assigned workspace's status/onboarding view, but no execution privilege.
- An inactive membership denies that resource scope. It does not change `User.role`.
- A role/membership mismatch returns a controlled forbidden or conflict response and a remediation path; it does not fall back to Customer.
- Unknown or unsupported roles fail closed.
- Frontend route state, query parameters, local storage and requested deep links never establish authorization.

## 8. Authentication workspace resolution contract

Extend the authenticated account response through a server-authoritative workspace resolver (preferably `GET /auth/me`) to return:

- stable user identity fields already exposed;
- primary `role` and a canonical `workspace` value derived from that role;
- account status needed for a safe access-state decision;
- a minimal workspace readiness/status object (for example Driver application state, or whether the primary workspace has an eligible active membership);
- a canonical landing route for the primary workspace.

Do not return full membership lists, private partner/hub records or operational data merely to choose a landing page. Workspace readiness must be computed server-side and scoped to the user. The response is a routing hint; every resource API remains independently authorized.

The login response and session restoration response must agree with `/auth/me`. The frontend must not route from stale role data returned only by a previous login response.

## 9. Source audit findings that drive implementation

Verified against the current source during WSP-01:

- `UserRole` already contains `CUSTOMER`, `DRIVER`, `HUB_OPERATOR`, `PARTNER_OPERATOR`, `SUPPORT` and `ADMIN`; `UserStatus` is separately modeled.
- Authentication middleware reads the current database role and account status on each request. `/auth/me` currently returns identity and role only; no workspace/readiness resolver exists.
- Driver onboarding creates a pending `DriverProfile` but does not set the primary role. Driver review currently sets role to `DRIVER` on approval and `CUSTOMER` on rejection. Reapplication also resets role to `CUSTOMER`. These transitions conflict with this contract.
- Driver document self-service routes currently require authentication but do not explicitly require `DRIVER`; Admin document routes are guarded.
- Driver vehicle and capability self-service routes explicitly require `DRIVER`.
- Partner execution routes require authentication, then enforce active partner membership and partner status in the service. The routes do not yet explicitly require the `PARTNER_OPERATOR` primary role.
- Partner membership creation/status changes do not mutate `User.role`.
- The public hub application is specifically a Partner OWNER workflow, not a standalone hub-owner application. Approval creates a pending hub and manager membership, without changing `User.role`.
- Hub membership administration and hub-point Admin routes are Admin-guarded.
- Support ticket creation and own-ticket access are shared authenticated capabilities. Support queue, updates and escalation are restricted to `SUPPORT` or `ADMIN`.
- The frontend currently places operational routes in the root authenticated `AppLayout`; that route guard denies only `ADMIN`. Login preserves a requested path or falls back to `/`, rather than resolving the primary workspace.

This audit is not a claim that every API route has been inventoried. WSP-01 remains open until custody, dispatch, booking, notifications, finance, cancellations, media, operations-control and all frontend API consumers have a complete route/role matrix and regression coverage.

## 10. Implementation sequence and exit gates

### WSP-01 — Complete route and consumer audit (in progress)
Complete the route-by-route backend authorization inventory and frontend route/API consumer matrix. Identify ownership checks, membership scope, role guards and data minimization behavior.

### WSP-02 — Adopt this authorization contract
Review and merge the primary-workspace, membership, lifecycle, provisioning and resolver rules before runtime changes.

### WSP-03 — Backend authorization and lifecycle enforcement
- Assign `DRIVER` at explicit driver application submission.
- Remove automatic Driver-to-Customer role resets on rejection/reapplication.
- Add explicit, audited Admin role provisioning/conversion for Partner and standalone Hub workspace accounts.
- Add missing primary-role guards and preserve resource-level membership checks.
- Add a minimal workspace resolver to `/auth/me`.
- Add regression tests for cross-role, inactive-membership, wrong-resource and lifecycle cases.

### WSP-04 — Frontend workspace integration
- Create separate Customer, Driver, Hub, Partner, Support and Admin route/layout families.
- Resolve login and session restoration from the backend workspace contract.
- Keep Partner owners in Partner workspace while exposing only their explicitly associated hub capabilities.
- Deny direct URLs into every other workspace.
- Do not build a workspace switcher.

### WSP-05 — Cross-workspace acceptance
Run role/status/deep-link/API ownership tests and staging acceptance for every supported workspace. CI must pass on the latest PR head before merge.

## 11. Non-negotiable invariants

1. One primary workspace per account.
2. Memberships are scoped entitlements, never implicit workspace switches.
3. Partner owners who manage hubs remain Partner Operators.
4. Driver rejection/reapplication never silently restores Customer access.
5. No operational role falls back to Customer on suspension, inactive membership or failed authorization.
6. Every API enforces role plus ownership/membership/capability as applicable.
7. Shared support ticket creation does not confer Support workspace access.
8. Admin oversight does not confer customer or operational execution rights.
9. Role transitions are explicit, prerequisite-checked and audited.
10. No production deployment or database migration is implied by this contract.


## 10. Canonical workspace resolution (WSP-03B)

The backend resolver derives the workspace key and landing route from the current `User.role`. It does not accept a requested workspace, client-supplied role, query parameter or stored frontend preference.

| Primary role | Workspace key | Canonical landing route |
|---|---|---|
| `CUSTOMER` | `CUSTOMER` | `/` |
| `DRIVER` | `DRIVER` | `/driver` |
| `PARTNER_OPERATOR` | `PARTNER` | `/partner` |
| `HUB_OPERATOR` | `HUB` | `/hub` |
| `SUPPORT` | `SUPPORT` | `/support` |
| `ADMIN` | `ADMIN` | `/admin` |

The `workspace` object returned by login and `GET /auth/me` contains:

- `key`: canonical workspace identifier derived from `User.role`;
- `status`: `READY`, `RESTRICTED` or `BLOCKED`;
- `reasonCode`: stable machine-readable explanation when readiness is not READY;
- `landingPath`: canonical workspace landing route, or null for unsupported roles;
- `profileStatus`: Driver profile verification state when applicable.

Readiness rules:

- Customer, Support and Admin resolve to READY after authentication has passed the account-status gate.
- Driver requires its own DriverProfile. PENDING, REJECTED and NOT_SUBMITTED profiles remain in the Driver workspace with RESTRICTED readiness. A suspended profile is also RESTRICTED. Only a verified, non-suspended profile resolves READY; execution APIs still enforce all KYC, vehicle, capability, safety, availability and assignment checks.
- Partner requires at least one active membership whose partner is both ACTIVE and VERIFIED. A pending/unverified partner is RESTRICTED; no active membership or only non-operational partner resources is BLOCKED.
- Hub requires at least one active membership whose hub is ACTIVE and whose operator verification is VERIFIED. A pending hub is RESTRICTED; no active membership or only non-operational hubs is BLOCKED.
- A Partner owner with hub memberships remains in the Partner workspace; Hub memberships are not considered when resolving the primary workspace for `PARTNER_OPERATOR`.
- Inactive memberships are excluded from readiness. A blocked operational workspace is never rewritten to Customer.
- An inactive account or unsupported role fails closed.

This response is a routing/readiness hint, not an authorization grant. Every operational API continues to enforce role, membership, exact resource scope and execution eligibility independently. No membership IDs or private partner/hub records are returned by the resolver.

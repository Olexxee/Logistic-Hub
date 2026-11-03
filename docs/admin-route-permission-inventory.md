# Administrative Route and Permission Inventory

**Phase:** 3A.1 — inventory baseline  
**Status:** Source-reviewed; current role guards inventoried. Granular permission design is not implemented.  
**Baseline:** `main` source mounted by `src/app.js`, reviewed 31 October 2026.  
**Purpose:** establish the authorization surface before changing permissions. This document records the current implementation, not the desired future model.

## Authorization model currently implemented

The authentication middleware in `src/modules/auth/auth.middleware.js`:
- Requires a valid bearer access token.
- Reloads the user from the database and requires an ACTIVE, email-verified account.
- Checks the session when the token contains a session ID.
- Attaches `req.user` and `req.auth`.
- Implements `requireRole(...roles)` as an exact role allow-list, returning 403 when the role is not included.

There is no granular action-permission middleware or policy registry in the current baseline. A route guarded by `requireRole("ADMIN")` grants every active ADMIN access to that route; a route guarded by `requireRole("ADMIN", "SUPPORT")` grants both roles the same route-level access. This is the current boundary, not a statement that every action is appropriate for those roles.

## 1. Administrative and privileged route inventory

All paths below are absolute API paths after the mounts in `src/app.js`.

| Module / capability | Route(s) | Current guard | Current access |
|---|---|---|---|
| Audit history | `GET /api/v1/admin/audit-events` | Router-wide `requireAuth` + `requireRole("ADMIN")` | ADMIN |
| User directory | `GET /api/v1/admin/users` | Route-level auth + ADMIN | ADMIN |
| User account status | `PATCH /api/v1/admin/users/:userId/status` | Route-level auth + ADMIN | ADMIN; non-admin target only; reason required; suspension revokes active sessions |
| Target-user session revocation | `POST /api/v1/admin/users/:userId/sessions/revoke-all` | Route-level auth + ADMIN | ADMIN; non-admin target only; reason required |
| Geography administration | `GET/POST/PATCH /api/v1/geography/admin/countries*`; `GET/POST/PATCH /api/v1/geography/admin/states*`; `GET/POST/PATCH/DELETE /api/v1/geography/admin/lgas*` | Router-wide auth + ADMIN | ADMIN |
| Service-zone administration | `GET/POST /api/v1/service-zones/admin`; `PATCH /api/v1/service-zones/admin/:serviceZoneId`; `PATCH /api/v1/service-zones/admin/:serviceZoneId/status`; `PUT /api/v1/service-zones/admin/:serviceZoneId/availability` | Route-level auth + ADMIN | ADMIN |
| Hub applications | `GET /api/v1/admin/hub-applications`; `POST /api/v1/admin/hub-applications/:applicationId/approve`; `POST /api/v1/admin/hub-applications/:applicationId/reject` | Route-level auth + ADMIN | ADMIN; approval/rejection reason required; approval revalidates active partner ownership and creates a PENDING partner-owned hub |
| Partner hub applications | `GET/POST /api/v1/partner/hub-applications`; `POST /api/v1/partner/hub-applications/:applicationId/withdraw` | Auth + active partner OWNER membership checked in service | Authenticated user must be active, email-verified partner OWNER; may view/withdraw own submissions |
| Hub administration | `GET/POST /api/v1/hub-points/admin`; `PATCH /api/v1/hub-points/admin/:hubPointId`; `PATCH /api/v1/hub-points/admin/:hubPointId/status`; `PATCH /api/v1/hub-points/admin/:hubPointId/operator-verification` | Route-level auth + ADMIN | ADMIN |
| Hub operator administration | `GET/POST /api/v1/admin/hub-points/:hubPointId/operators`; `PATCH /api/v1/admin/hub-points/:hubPointId/operators/:operatorId`; `PATCH /api/v1/admin/hub-points/:hubPointId/operators/:operatorId/role` | Route-level auth + ADMIN | ADMIN; scoped role/status changes require an audit reason; active hubs retain an active manager |
| Recipient phone verification | `PATCH /api/v1/admin/users/:userId/phone-verification` | Route-level auth + ADMIN | ADMIN |
| Driver administration | `GET /api/v1/drivers/admin/drivers`; `GET /api/v1/drivers/admin/vehicles`; `PATCH /api/v1/drivers/admin/drivers/:driverProfileId/status`; `GET /api/v1/drivers/admin/drivers/:driverProfileId/audit`; `PATCH /api/v1/drivers/admin/:driverProfileId/verification`; `PATCH /api/v1/drivers/admin/vehicles/:vehicleId/verification`; `PUT /api/v1/drivers/admin/coverage` | Nested admin router or route-level auth + ADMIN | ADMIN |
| Partner directory, memberships and commercial terms | `GET/POST /api/v1/admin/transport-partners`; `GET/PATCH /api/v1/admin/transport-partners/:partnerId`; `PATCH /api/v1/admin/transport-partners/:partnerId/status`; `GET/POST /api/v1/admin/transport-partners/:partnerId/agreements`; `GET /api/v1/admin/partner-agreements/:agreementId`; `POST /api/v1/admin/partner-agreements/:agreementId/activate`; `PATCH /api/v1/admin/partner-agreements/:agreementId/status`; `GET/POST /api/v1/admin/partner-agreements/:agreementId/rate-cards`; `GET /api/v1/admin/partner-rate-cards/:rateCardId`; `POST /api/v1/admin/partner-rate-cards/:rateCardId/rates`; `POST /api/v1/admin/partner-rate-cards/:rateCardId/publish`; plus AH-5.2 partner-member roster/add/update routes | Admin router-wide auth + ADMIN | ADMIN |
| Partner membership and assignment | `GET/POST /api/v1/admin/transport-partners/:partnerId/members`; `PATCH /api/v1/admin/transport-partners/:partnerId/members/:memberId`; `POST /api/v1/admin/delivery-legs/:legId/partner-assignment` | Route-level auth + ADMIN | ADMIN |
| Partner quote issuance | `POST /api/v1/admin/parcel-bookings/:bookingId/quotes` | Route-level auth + ADMIN | ADMIN |
| Partner quote listing | `GET /api/v1/admin/quotes` | Route-level auth + ADMIN or SUPPORT | ADMIN, SUPPORT |
| Operational cases | `GET /api/v1/admin/operational-cases`; `PATCH /api/v1/admin/operational-cases/:caseId` | Scoped router auth + ADMIN | ADMIN |
| Operations control centre | `GET /api/v1/admin/operations/overview` | Route-level auth + ADMIN | ADMIN |
| Support queue | `GET /api/v1/support/admin/tickets`; `PATCH /api/v1/support/admin/tickets/:ticketId` | Route-level auth + ADMIN or SUPPORT | ADMIN, SUPPORT |
| Finance — refund review | `GET /api/v1/finance/admin/refunds`; `PATCH /api/v1/finance/admin/refunds/:refundId` | Route-level auth + ADMIN or SUPPORT | ADMIN, SUPPORT |
| Finance — payout settlement confirmation | `GET /api/v1/finance/admin/payouts`; `PATCH /api/v1/finance/admin/payouts/:payoutId/confirm-settlement` | Route-level auth + ADMIN or SUPPORT | ADMIN, SUPPORT |
| Finance — reconciliation | `GET /api/v1/finance/admin/reconciliation` | Route-level auth + ADMIN | ADMIN |
| Partner payable and settlement administration | `GET /api/v1/admin/partner-payables`; `PATCH /api/v1/admin/partner-payables/:payableId/approve`; `POST /api/v1/admin/partner-payables/:payableId/adjustments`; `PATCH /api/v1/admin/partner-payable-adjustments/:adjustmentId/approve`; `POST /api/v1/admin/transport-partners/:partnerId/settlement-batches`; `GET /api/v1/admin/partner-settlement-batches`; `PATCH /api/v1/admin/partner-settlement-batches/:batchId/approve`; `POST /api/v1/admin/partner-settlement-batches/:batchId/reconcile` | Route-level auth + ADMIN | ADMIN |

### Authorization review flags

These are findings to resolve in 3A.2 and later slices, not permission changes made in 3A.1.

1. **Broad ADMIN authority:** most administrative capabilities are protected only by the global ADMIN role. A compromised or over-provisioned admin account can access geography, user, partner, hub, operational, financial and audit functions.
2. **SUPPORT financial authority:** SUPPORT currently shares access with ADMIN for refund review and payout settlement confirmation. Confirm whether SUPPORT should be able to confirm settlement; do not assume that ticket-management authority implies financial authority.
3. **Partner quote access:** SUPPORT can list admin quotes, while quote issuance is ADMIN-only. Confirm that read access is necessary and ensure customer/partner-sensitive pricing data is appropriately scoped.
4. **Audit coverage is not uniform:** an ADMIN-only audit read endpoint exists, and selected services emit operational audit events. The presence of an audit module does not prove every privileged mutation emits an event.
5. **Custody and hub operations:** several routes are authenticated but do not have a route-level role guard. Their safety depends on service-level party, membership and object-scope checks. Those checks need explicit review and tests; do not classify them as generally accessible merely because the router lacks `requireRole`.
6. **Global role mutation remains intentionally unavailable:** no platform OWNER role exists to authorize ADMIN grants/revocations safely. The admin user controls support account suspension/reactivation and target-user session revocation only. Phone verification is a separate privileged action.
7. **No generic admin shipment-status override route was found in the reviewed route modules:** preserve this boundary.

### Legacy privileged router — not mounted

`src/modules/payments/financial.routes.js` declares legacy financial routes guarded by authentication and either ADMIN/SUPPORT or ADMIN. The current `src/app.js` explicitly states that this legacy `financialRouter` is intentionally not mounted; finance operations are mounted under `/api/v1/finance`. These declarations are included in the source-level regression allow-list so dormant code cannot silently become active or be mistaken for the current API contract. Do not document or call its route paths as live endpoints.

## 2. Other authenticated routes with operational impact

These routes are not ADMIN-only, but they affect privileged operational resources and must be included in the broader security review.

| Area | Route family | Route-level guard | Required domain boundary |
|---|---|---|---|
| Partner execution | `/api/v1/partner/assignments*` | Authentication | Must resolve active partner membership and assignment ownership/eligibility. |
| Partner membership discovery | `GET /api/v1/partner/memberships/mine` | Authentication | Caller identity only; must return the caller's memberships. |
| Hub operator discovery | `GET /api/v1/hub-operator/memberships/mine` | Authentication | Caller identity only; must return the caller's memberships. |
| Hub operations | `/api/v1/hub-operations/*` | Authentication | Must verify active hub membership, role, hub scope, handover parties and delivery-leg eligibility in the service layer. |
| Hub staff management | `GET/POST /api/v1/hub-operations/hubs/:hubPointId/operators` | Authentication; service-level active MANAGER membership for the exact hub | Manager may view that hub's memberships and add OPERATOR memberships only. Cannot self-add, grant MANAGER, alter manager memberships, or reactivate an administrator-deactivated membership. Admin retains role changes and revocation. |
| Delegated hub dispatch | `POST /api/v1/hub-operations/hubs/:hubPointId/delivery-legs/:legId/request-matching` | Authentication; exact-hub active membership with `canDispatch=true` | Permission is granted/revoked only by ADMIN with an audit reason. Dispatch is limited to local-driver legs originating at that hub. It does not grant fare acceptance, booking ownership or access to another hub. |
| Dispatch permission administration | `PATCH /api/v1/admin/hub-points/:hubPointId/operators/:operatorId/dispatch-permission` | ADMIN | Requires a reason; grants only on ACTIVE hubs to active, verified members. Deactivation and role changes clear delegation. Revocation remains possible for inactive hubs/memberships. |
| Custody handovers | `/api/v1/custody/handovers*` | Authentication | Must verify participant identity, booking ownership/party relationship and legal custody transition. |
| Customer support | `POST /api/v1/support/tickets`; `GET /api/v1/support/tickets/mine` | Authentication | Customer ownership; customer reads must exclude internal-only staff content. |
| Cancellation | `POST /api/v1/cancellations` | Authentication | Booking ownership and cancellation eligibility in the service/repository. |
| Refund request | `POST /api/v1/finance/refund-requests` | Authentication | Caller ownership and payment/refund state eligibility. |
| Driver operations | `/api/v1/drivers/me`, onboarding, availability and location | Authentication; selected operations additionally require DRIVER | Driver identity/profile ownership and verified eligibility. |
| Driver assignments | `/api/v1/driver/assignments/mine` and assignment actions | Authentication + DRIVER for driver actions | Assignment ownership and lifecycle eligibility. |
| Booking and dispatch | Parcel/ride booking, offers and fare acceptance routes | Authentication; driver offer actions require DRIVER | Booking ownership, assigned driver identity, quote acceptance and state-machine checks. |
| Delivery-leg matching | Delivery-leg matching and offers | Authentication; driver offer actions require DRIVER | Booking ownership, offer ownership and delivery-leg eligibility. |
| Notifications | `/api/v1/notifications/*` | Authentication | Notification recipient must be the authenticated user. |
| Payment lookup | `GET /api/v1/payments/:paymentAttemptId` | Authentication | Payment attempt must belong to the caller or be explicitly authorized. |

## 3. Route modules included in the source-level inventory guard

The regression test scans every `src/modules/**/*.routes.js` file and compares detected administrative route modules against this exact allow-list:

- `src/modules/audit/audit.routes.js`
- `src/modules/custody/custody.routes.js`
- `src/modules/discovery/discovery.routes.js`
- `src/modules/drivers/drivers.admin.routes.js`
- `src/modules/drivers/drivers.routes.js`
- `src/modules/finance/finance.routes.js`
- `src/modules/geography/geography.admin.routes.js`
- `src/modules/geography/service-zones.routes.js`
- `src/modules/hub-points/hub-points.routes.js`
- `src/modules/operational-cases/operational-cases.routes.js`
- `src/modules/operations-control/operations-control.routes.js`
- `src/modules/partner-execution/partner-execution.routes.js`
- `src/modules/partner-pricing/partner-pricing.admin.routes.js`
- `src/modules/partner-pricing/partner-pricing.routes.js`
- `src/modules/partner-settlement/partner-settlement.routes.js`
- `src/modules/payments/financial.routes.js` (legacy router; not mounted)
- `src/modules/support/support.routes.js`

The source-level test detects route modules containing administrative paths or ADMIN role declarations, verifies the module is represented in this inventory, and verifies the source contains authentication and role-guard declarations. It is a change-detection safeguard, not a substitute for HTTP integration tests or review of service-level ownership checks.

## 4. Existing authorization tests

Existing test coverage found on the baseline includes:
- `test/auth-middleware.test.js`: active session authentication, revoked-session rejection and role denial.
- `test/audit.routes.test.js`: audit history is ADMIN-only and supports entity/action filters.
- `test/hub-points-admin.routes.test.js`: hub administration denies CUSTOMER and allows ADMIN.
- `test/drivers-admin.routes.test.js` and `test/drivers-admin-suspension.routes.test.js`: driver admin route and suspension coverage.
- `test/partner-pricing-admin.routes.test.js` and `test/partner-pricing-admin.integration.test.js`: partner pricing admin authorization and behavior.
- `test/discovery.routes.test.js`: discovery route coverage.
- `test/priority-3-eligibility-authorization.integration.test.js`: driver eligibility and authorization integration coverage (PostgreSQL-gated).

Coverage is representative, not exhaustive. Route-level authorization tests are still needed for support, finance, geography, custody admin mutations, partner execution admin mutations, operational cases and partner settlement.

## 5. 3A.1 exit criteria

- [x] Enumerate every route module that declares administrative paths or ADMIN role guards.
- [x] Record current route-level role boundaries and mounted absolute paths.
- [x] Identify authenticated operational routes whose security depends on service-level ownership/membership checks.
- [x] Record existing authorization test coverage and known gaps.
- [x] Add a source-level regression test to detect new administrative route modules omitted from this inventory.
- [ ] Review and approve the inventory before changing role semantics or introducing granular permissions.

## 6. Explicit non-goals for 3A.1

- No new permission framework or permission database model.
- No role changes or expansion/reduction of SUPPORT authority.
- No user role-management endpoint.
- No change to shipment, payment, refund or partner-settlement state machines.
- No production migration, live payment activation or external partner transfer.

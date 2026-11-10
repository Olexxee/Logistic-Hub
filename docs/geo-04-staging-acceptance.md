# GEO-05 — Staging acceptance and live-data audit

**Audit date:** 2026-11-10  
**Status:** Staging infrastructure is live and isolated; data and authenticated acceptance remain blocked.  
**Scope:** Staging-only provisioning and read-only verification. Production database, production environment variables, production service, and production deployment remain untouched.

## 1. Environment inventory

### Production (unchanged)

- Backend Render service: https://logistic-hub-w4ma.onrender.com
- Production service ID: `srv-dbivog142hec73bl44ig`
- Production database is the existing Prisma-hosted production database. It was not queried or modified during GEO-05.
- No production deployment was triggered by GEO-05.

### Staging

- Backend Render service: https://logistic-hub-staging.onrender.com
- Staging service ID: `srv-dboun6mi0phs73esnthg`
- Dedicated Prisma database: `logistic-hub-staging`
- Prisma database ID: `db_pv7fuueah4v4grs3xlec3acv`
- Database project ID: `proj_zaltn1lk48k0jbm1sbumrfaj`
- Database name reported by the approved baseline query: `postgres`
- Render runtime pinned to Node `22.21.1`.
- Staging configuration: `APP_STAGE=staging`, `DRIVER_KYC_MODE=STRICT`, `PAYMENTS_ENABLED=false`, `REFUNDS_ENABLED=false`, `MAPS_PROVIDER=none`, and `EMAIL_PROVIDER=none`.
- Staging uses a dedicated database connection and JWT secret. Secret values must never be committed or copied into documentation.
- No production customer data was copied into staging.

## 2. Deployment and connectivity evidence

- Staging service was created separately from production and is configured from the Logistic Hub repository's `main` branch.
- Initial deployment completed successfully after staging environment variables were configured.
- Render build/runtime logs confirmed migrations applied, application startup, Node `22.21.1`, and a successful database connection.
- Render health checks recorded HTTP 200 for the public root endpoint.
- The readiness endpoint `/api/v1/health/ready` was not independently verified by an HTTP request; do not treat root liveness as proof of readiness.
- GEO-05 backend PR [#141](https://github.com/Olexxee/Logistic-Hub/pull/141) was merged after its required CI check passed. It changes refresh-cookie configuration so `APP_STAGE=staging` uses a Secure `__Host-lh_refresh` cookie while retaining `NODE_ENV=development`.
- The staging deployment for merge commit `db4a5f6c992b9db16d14480bb679d48330d3dee4` was observed in `build_in_progress` at the time of this audit. Do not mark the new cookie behavior deployed until the deployment is confirmed live.
- The staging auth flow is still not browser-ready: `CORS_ORIGINS` is empty and no separate staging frontend origin has been configured. `EMAIL_PROVIDER=none` also means email verification delivery is not configured.

## 3. Approved staging database baseline

A read-only SQL baseline query was approved and executed against the dedicated staging database. It returned:

| Table | Count |
|---|---:|
| countries | 0 |
| states | 0 |
| lgas | 0 |
| users | 0 |
| service_zones | 0 |

This confirms the staging database was empty at baseline. It does not imply that any geography or operational records have since been seeded.

## 4. Nigeria geography seed — approved, not yet executed

The existing `scripts/seed-nigeria-geography.js` was inspected in full.

Its safeguards include:
- Validates the bundled reference dataset: 37 state-level units and 774 LGAs/Area Councils, including six FCT Area Councils.
- Rejects duplicate, conflicting, and unrecognised existing geography records before writes.
- Defaults to dry-run; writes require `--apply` and an exact `--confirm-database=<database-name>`.
- Applies writes in a Serializable transaction and verifies final country/state/LGA counts.
- Does not create or modify service zones, availability, hubs, partners, pricing, driver coverage, or bookings.

The user explicitly authorized running this script against the empty staging database. The script has **not** been executed. The available connected execution interfaces do not provide a one-off shell/command runner for the existing Render service, and the Prisma SQL interface is not an appropriate substitute for executing this validated application seed script. No hand-written SQL replacement, recurring cron job, or temporary unauthenticated seed endpoint was introduced.

**Required next step:** execute the existing script once against the dedicated staging `DATABASE_URL`, using the exact confirmation for the actual database name. Keep the connection string out of shell history, logs, PRs, and chat. Then run a read-only verification query for country/state/LGA counts and active flags. Stop if the database identity does not match the dedicated staging target.

## 5. Acceptance matrix

| Check | Result | Evidence / reason |
|---|---|---|
| Separate staging backend service | PASS | Dedicated Render service and URL |
| Separate staging database | PASS | Dedicated Prisma database ID |
| Staging DB empty baseline | PASS | Approved read-only query: all five counts zero |
| Staging migration deployment | PASS | Render build logs reported migrations applied |
| Staging Node 22 runtime | PASS | Render logs reported Node 22.21.1 |
| Staging application startup | PASS | Render logs reported startup and DB connection |
| Root liveness | PASS | Render root health check HTTP 200 |
| Dedicated readiness endpoint | NOT VERIFIED | No direct successful HTTP result recorded |
| Secure staging refresh-cookie code | PASS | PR #141 merged; unit tests included |
| Secure staging cookie deployed | PENDING | Staging deploy for merge commit was still building |
| Nigeria geography seed | APPROVED / NOT EXECUTED | Safe one-off execution mechanism not available through connected tools |
| Geography post-seed verification | NOT RUN | Depends on seed execution |
| Staging Admin account | NOT PROVISIONED | Controlled bootstrap path still required |
| Staging frontend deployment | NOT PROVISIONED | Separate frontend origin required |
| Browser CORS/auth acceptance | BLOCKED | `CORS_ORIGINS` empty; no staging frontend origin |
| Email verification flow | BLOCKED | Staging email provider is disabled |
| GEO-03/GEO-04 readiness acceptance | NOT RUN | Requires seeded geography, Admin access, and staging frontend/auth |

## 6. Admin bootstrap and browser access

Public registration creates customer accounts; it is not an acceptable path to create a privileged staging Admin. No Admin account has been created. The next implementation must use a narrowly scoped staging-only bootstrap mechanism, must not be reachable in production, and must not embed credentials in source control.

Before browser acceptance:
1. Provision a distinct staging frontend deployment.
2. Set the staging backend `CORS_ORIGINS` to the exact staging frontend origin only.
3. Implement or use an audited staging-only Admin bootstrap path.
4. Decide how staging email verification is completed. Do not weaken production email verification or auth policy to accommodate staging.

## 7. GEO-04 operational acceptance

After geography and Admin access are available:
1. Call `GET /api/v1/service-zones/admin/readiness?serviceType=PARCEL_DELIVERY` with the staging Admin session.
2. Review each candidate zone's active parent geography, valid boundary, effective availability, effective zone/global fallback pricing, overlap warnings/blockers, and configured driver coverage.
3. Reconcile the report against the Admin boundary editor and seeded state/LGA relationships.
4. Test inside-boundary, outside-boundary, polygon-hole, shared-edge, invalid-boundary, inactive-availability, and mismatched-client-hint booking cases.
5. Separately verify driver KYC, vehicle eligibility, online/location freshness, and operational capacity. GEO-04 coverage counts do not certify dispatchability.
6. Keep all service zones inactive until the user explicitly approves operational activation.

## 8. Safety status

- Production database: untouched.
- Production environment variables: untouched.
- Production deployment: not triggered by GEO-05.
- Staging database: only the approved read-only baseline query was run; geography seed remains unexecuted.
- No service zones, availability, pricing, driver coverage, bookings, hubs, or partner records were created or activated.

**Release decision:** staging infrastructure exists and is isolated, but GEO-05 acceptance remains blocked on geography seed execution, controlled Admin provisioning, staging frontend/CORS, and end-to-end acceptance. Do not activate any service zone as part of these setup steps.

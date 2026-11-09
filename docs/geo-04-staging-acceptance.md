# GEO-04 — Staging acceptance and live-data audit

**Audit date:** 2026-11-09  
**Status:** Not accepted. Code deployment is verified; staging data acceptance is blocked.  
**Scope:** Read-only environment/deployment inspection and rollout-gate reconciliation. No database writes, zone activation, availability changes, pricing changes, boundary edits, coverage edits, or deployment actions were performed as part of this audit.

## 1. Implementation and deployment evidence

- Backend GEO-04 PR [#139](https://github.com/Olexxee/Logistic-Hub/pull/139) is merged.
- Frontend GEO-04 PR [#61](https://github.com/Olexxee/logistic-frontend/pull/61) is merged.
- Backend Render service: [Logistic-Hub](https://dashboard.render.com/web/srv-dbivog142hec73bl44ig), primary URL https://logistic-hub-w4ma.onrender.com.
- The latest observed live deployment is `dep-dbou92rhf81s73c2r9og`, running commit `42f2e250bde3ae0b0b21f0dddc2fa34a4b22fbaf` (the merge of backend PR #119). Its parent deployment was the GEO-04 merge commit `923b03879660514a574348fb1fa8c6090936d073`, confirming GEO-04 is included in the deployed mainline.
- Render reported the deployment status as `live`. Application logs show `server.listening`, a successful database connection to the Prisma-hosted PostgreSQL endpoint, and HTTP `GET /` returning 200.
- The backend logs report `environment: production`. This is not a staging deployment.
- The deployed runtime reported Node.js `v26.13.0`. The backend package declares `engines.node >=22.0.0`; that range permits Node 26, but it does not pin the project's intended Node 22 runtime. Runtime parity with the intended Node 22 baseline is therefore not established.

## 2. Environment inventory and access boundary

- The connected Render workspace currently exposes one Logistic Hub web service on the `main` branch. No separate Logistic Hub staging web service or preview service was found.
- The Render workspace contains no Render-managed PostgreSQL instance.
- The Prisma workspace contains a `logistic-hub` project with one PostgreSQL database and only a `main` branch marked `production`; no preview/staging branch or separate staging database exists.
- Application logs identify the database provider as Prisma-hosted PostgreSQL (`pooled.db.prisma.io`). Render's read-only Postgres query facility cannot query this external database.
- No staging database connection or authorized staging Admin session/token was available during this audit.
- The readiness endpoint is Admin-authenticated: `GET /api/v1/service-zones/admin/readiness?serviceType=PARCEL_DELIVERY`. The route's authorization middleware is present in the deployed source, but this audit did not execute an authenticated readiness request.

**Conclusion:** We do not currently have an isolated staging target or the credentials/connector required to run a read-only readiness query against the actual service-zone records. The production service must not be treated as staging, and the production database must not be modified to simulate staging.

## 3. Acceptance matrix

| Check | Result | Evidence / reason |
|---|---|---|
| Backend GEO-04 merged | PASS | Backend PR #139 merged |
| Frontend GEO-04 merged | PASS | Frontend PR #61 merged |
| GEO-04 included in live mainline deploy | PASS | Live deployment commit follows the GEO-04 merge commit |
| API process starts | PASS | Render application logs show server listening |
| Database connectivity at boot | PASS | Application logs show database.connected |
| Public root health response | PASS | Render request log records GET / with HTTP 200 |
| Dedicated staging service | BLOCKED | No separate Logistic Hub staging service found |
| Dedicated staging database | BLOCKED | No Render Postgres instance; external Prisma DB not queryable through Render SQL tool |
| Authenticated readiness endpoint | NOT RUN | No staging Admin session/token available |
| Actual zone readiness counts | NOT RUN | No authorized read-only staging database/API access |
| Boundary overlap review against real zones | NOT RUN | Depends on readiness response and Admin map review |
| Driver coverage eligibility review | NOT RUN | Endpoint counts enabled coverage configuration only; it does not prove driver eligibility |
| Node 22 runtime parity | BLOCKED | Deployed runtime reports Node 26.13.0; package engine range is open-ended |
| Booking-resolution scenario tests on staging | NOT RUN | No staging environment available |

## 4. Important operational interpretation

The GEO-04 report's `bookingReady` field is a preflight indicator, not a launch approval. It requires active geography, a valid boundary, effective availability, and effective pricing. The report's enabled driver-coverage count only measures configured coverage records; it does not establish KYC approval, driver online status, vehicle eligibility, or dispatchability.

GEO-03 booking-time resolution remains authoritative and fails closed for missing, invalid, or ambiguous zone matches. Do not activate a zone because the report labels it booking-ready. Do not infer operational readiness from a successful deployment or database connection.

## 5. Required work before acceptance can be marked complete

1. Establish a genuinely isolated staging deployment and staging database. Do not point staging at the production database.
2. Pin the backend runtime to the agreed Node 22 line in the deployment configuration, then verify the next staging boot reports Node 22. Do not change the live production service as part of this audit.
3. Provide a staging Admin test account through the normal controlled account-provisioning process; do not place credentials or tokens in this document or repository.
4. Run the Admin-only readiness endpoint against staging for `PARCEL_DELIVERY` and capture counts plus each zone's blockers/warnings.
5. Reconcile every candidate zone against the Admin boundary editor, state/LGA relations, effective availability windows, active zone/global fallback pricing, and enabled driver coverage.
6. Validate overlap results for disjoint, overlapping, shared-edge/touching, and hole cases using actual staging geometries. Resolve ambiguity before enabling overlapping service.
7. Run booking tests for inside-boundary, outside-boundary, hole, shared-edge, invalid-boundary, inactive-availability, and mismatched-client-hint cases. Confirm the server independently resolves pickup and destination.
8. Review driver KYC, vehicle eligibility, online/location freshness, and operational capacity separately; the GEO-04 report does not certify them.
9. Record the exact staging deployment commit, Node version, database identity (non-secret identifier only), report timestamp, and test results in this document before approving rollout.

## 6. Safety status

No service zone was activated or deactivated. No boundary, availability, pricing, driver coverage, booking, or database record was changed. No migration was run. No production deployment was triggered by this audit.

**Release decision:** GEO-04 implementation is deployed, but operational acceptance is **blocked**. Keep service activation and rollout decisions separate from this code-completion milestone.

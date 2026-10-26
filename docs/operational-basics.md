# Operational Basics

## Implemented in this increment

- `GET /api/v1/health` reports process health only.
- `GET /api/v1/health/ready` checks the PostgreSQL connection using a minimal query. It returns 503 with a sanitized error when the database is unavailable.
- `GET /api/v1/service-zones` lists active service zones only when the country, state, zone and at least one service availability are active for the current time.
- Geography filters: `countryCode` (defaults to `NG`), optional `stateCode`, optional `lgaCode`, and optional `serviceType`.
- Service availability windows are evaluated server-side. Reference geography existing in the database is not enough to make a zone operational.
- The endpoint returns only active service types, not internal zone boundary GeoJSON or pricing configuration.

## Not yet implemented

Authentication and authorization, registration and contact verification, driver onboarding, service-zone administration, maps HTTP routes, booking lifecycle endpoints, matching, payment processing and live tracking remain separate work. Do not treat the schema or OpenAPI plan as proof these workflows are live.

## Operational safety

- Keep the readiness endpoint free of connection strings and provider details.
- Keep health checks separate from readiness checks so a running process can be distinguished from one with a working database.
- Keep the service-zone endpoint read-only. Changes to active zones and service availability must be performed through an authenticated administrative workflow, which has not yet been implemented.

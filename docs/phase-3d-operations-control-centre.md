# Phase 3D — Operations control centre and exception management

**Status:** Initial implementation slice.  
**Baseline:** `main` after Phase 3C PR #52.  
**Scope:** A single ADMIN-only operational overview built from existing shipment, delivery-leg, custody, hub-intake, partner-assignment and operational-case records.

## 3D.1 Operations overview

- [x] Add a read-only `GET /api/v1/admin/operations/overview` endpoint.
- [x] Aggregate active shipments, active and failed delivery legs, pending custody handovers, hub-intake exceptions, active operational cases, critical cases, unassigned cases and active partner assignments.
- [x] Return an explicit generation timestamp.
- [x] Keep the endpoint aggregate-only; do not expose customer addresses, recipient contact data, evidence, payment details or raw shipment records.
- [x] Restrict the endpoint to authenticated ADMIN users.
- [x] Add service-level regression coverage and OpenAPI/mounted-route parity.
- [x] Serialize operational-case updates and retry bounded Prisma serialization conflicts.

## Explicit boundaries

- No generic shipment, delivery-leg, assignment, custody or payment status override.
- No automatic reassignment, cancellation or custody completion.
- No SLA/escalation clock is invented; the current schema has no approved operational SLA policy.
- No new database model, schema migration, production data change or payment activation.
- Existing operational-case lifecycle remains the authorized exception-resolution workflow. This slice does not broaden SUPPORT permissions or change existing ADMIN-only case administration.

## 3D.2 Operational case queue

- [x] Add case search across public reference, title and description.
- [x] Add filters for assignee, unassigned cases and creation date range.
- [x] Keep cursor pagination and existing priority/age ordering.
- [x] Explicitly select list response fields so evidence JSON and unrelated scalar fields are never returned by the queue endpoint.
- [x] Validate conflicting assignee filters and invalid date ranges.

## 3D.3 Exception correlation and duplicate prevention

- [x] Correlate active hub exceptions by delivery leg, hub and exception type before creating a new case.
- [x] Return the existing active case as an idempotent replay instead of creating a duplicate.
- [x] Preserve the rejected-handover to FAILED_HANDOVER case linkage; the handover lifecycle prevents repeat creation.
- [x] Keep the unified queue grounded in OperationalCase records and their existing booking, delivery-leg, custody, partner and hub relations. Do not manufacture a second shipment-status or exception-state system.

## 3D.4 Regression coverage

- [x] Cover operational-case search/filter composition, safe projection, cursor boundaries and invalid filter combinations.
- [x] Cover ADMIN-only queue access.
- [x] Cover repeated hub exception reporting and replay response semantics.
- [x] Validate OpenAPI response pagination shape and run PostgreSQL migration/integrity CI.

## Remaining 3D work

- Complete a final end-to-end verification against the deployed backend and frontend after both PRs are merged.
- Confirm production CORS and same-origin proxy configuration; no production deployment or data mutation is included in this phase.

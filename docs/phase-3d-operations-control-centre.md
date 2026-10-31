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

## Explicit boundaries

- No generic shipment, delivery-leg, assignment, custody or payment status override.
- No automatic reassignment, cancellation or custody completion.
- No SLA/escalation clock is invented; the current schema has no approved operational SLA policy.
- No new database model, schema migration, production data change or payment activation.
- Existing operational-case lifecycle remains the authorized exception-resolution workflow. This slice does not broaden SUPPORT permissions or change existing ADMIN-only case administration.

## Remaining 3D work

- Extend operational-case triage with stronger concurrency and filtering/search.
- Review exception creation coverage and make sure operational failures produce traceable cases without duplicate cases.
- Add a unified exception work queue only where source records can be correlated reliably and the action remains within existing domain state machines.
- Complete operational authorization, integration and PostgreSQL regression coverage.

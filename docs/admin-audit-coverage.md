# Administrative audit coverage

Last reviewed: 2026-10-31

This document records mutation-level audit coverage for Phase 3A.2. Route presence is not evidence of audit coverage; the unit of review is the successful domain mutation and its durable audit event.

## Coverage matrix

| Module / mutation family | Audit coverage | Transaction boundary | Evidence / notes |
|---|---|---|---|
| Driver administration | Suspension and reinstatement | Same Prisma transaction | `drivers.admin.service.js`; actor comes from authenticated admin |
| Geography administration | Country, state and LGA create/update/status/delete operations | Same Prisma transaction | `geography.admin.service.js`; LGA deletion records the pre-delete snapshot |
| Service-zone administration | Create, update, activation and service availability changes | Same Prisma transaction | `service-zones.admin.service.js`; availability upsert records previous and resulting state |
| Hub administration | Create, update, operator verification review and status changes | Same Prisma transaction | `hub-points.admin.service.js` |
| Support administration | Ticket update, assignment, status and priority changes | Same Prisma transaction | `support.service.js`; customer ticket creation is not an administrative mutation |
| Finance administration | Refund review decision, provider request result/failure, payout settlement confirmation | Same Prisma transaction | `finance.repository.js`; no payment activation is performed |
| Operational cases | Case status, priority, assignment and resolution changes | Existing repository transaction | `operational-cases.service.js` delegates to repository audit writer |
| Custody | Handover lifecycle, rejection/expiry and resulting custody transitions | Existing repository transaction | `custody.service.js` |
| Partner execution | Membership changes, leg assignment and partner assignment lifecycle | Same Prisma transaction | `partner-execution.service.js` |
| Partner pricing | Partner, agreement, rate-card and rate mutations | Same repository transaction | `partner-pricing.admin.service.js` |
| Partner settlement | Payable approval/adjustments, batch creation/approval and reconciliation | Same repository transaction | `partner-settlement.service.js` |
| Audit administration | Read-only audit access | Not applicable | Audit history read is restricted by route authorization |

## Shared writer

`src/shared/audit/operational-audit.js` provides the common writer for newly covered modules.

- Requires an interactive Prisma transaction client; a root Prisma client is rejected.
- Requires non-empty `actorUserId`, `entityType`, `entityId` and `action`.
- Supports a reason and minimal before/after/metadata snapshots.
- Does not swallow persistence failures. If audit insertion fails, the enclosing transaction fails and the domain mutation rolls back.
- Does not serialize arbitrary request bodies. Callers explicitly select fields to avoid recording credentials, tokens, payment payloads or unnecessary personal data.

## Explicitly unresolved / follow-up

1. **Provider webhooks and system-originated state changes:** the Prisma model already permits `actorUserId = null` and uses `onDelete: SetNull`; the earlier statement that the field was required was inaccurate. The gap was in the shared writer, which required a human actor, and the refund webhook repository path, which updated state without an audit event. Phase 3A.4 adds explicit `actorType: SYSTEM` events with a mandatory `systemSource`, stores the actor type/source in metadata, and audits webhook transitions in the same transaction. No migration or fabricated human actor is required. This convention must be used by future system-originated writers; a dedicated typed actor column remains a possible future schema improvement, not a prerequisite.
2. **Role policy:** the 3A.1 inventory flagged SUPPORT access to payout settlement confirmation and refund review. This PR preserves existing access; changing it requires a separate explicit authorization decision and tests.
3. **Full route-level authorization matrix:** representative route and service-level adversarial tests exist, but the 3A.1 inventory still identifies route tests to add for geography, support, finance, operational cases, partner execution and partner settlement. This is a tracked test-coverage gap; existing service authorization checks must not be inferred from router declarations alone.
4. **Audit immutability:** application code exposes no update/delete operation for audit events and domain writers only insert. This is application-level append-only behavior, not database-enforced immutability. Strong enforcement requires a separate database role/privilege and/or trigger design, validated against the actual production database roles. No schema migration or production privilege change is included in this phase because that requires explicit approval and deployment-specific verification.
5. **Retention and export:** the API supports bounded, deterministic page reads (maximum 100 records per request). There is no automatic deletion/retention job or dedicated bulk export endpoint. Do not invent a retention duration: Legal/compliance requirements and operational storage needs must determine it. Until then, retain audit records indefinitely and use the paginated ADMIN-only endpoint for controlled retrieval. A bulk export job requires a separately scoped authorization, rate-limit, field-redaction and audit trail design.
6. **Correlation/request IDs:** the HTTP layer creates a UUID request ID and returns X-Request-ID. Phase 3A.5 uses AsyncLocalStorage to propagate that ID through asynchronous service calls and includes it in audit metadata when a mutation originates from an HTTP request. System/background events without an HTTP request remain valid and omit requestId. No schema migration is required.

## Tests

- `test/operational-audit.test.js`: transaction-client enforcement and required audit context.
- `test/geography-admin.service.test.js`: geography mutation transaction fixtures and lifecycle guards.
- `test/priority-3-geography-hubs.integration.test.js`: PostgreSQL-backed service-zone and hub audit actor coverage.
- `test/finance-audit.test.js`: refund review, payout settlement and system-originated refund webhook audit events.
- Existing module tests cover operational-case, custody, partner execution, partner pricing and partner settlement behavior.

A module should only be marked complete after its mutation path, transaction boundary, actor source and failure behavior have been verified.


## Phase 3A.4 — System-originated audit events

- The shared writer now supports two explicit actor modes: HUMAN (default; requires actorUserId) and SYSTEM (requires actorUserId to be null and a non-empty systemSource).
- System identity is recorded in JSON metadata as actorType and systemSource; this is an application-level convention, not a new database enum/column.
- Refund webhook status transitions are now audited transactionally. Re-delivery of the same terminal status does not create a duplicate event because only rows whose status differs are selected and conditionally updated.
- The event stores only the provider event name and provider reference/status snapshots; it does not store raw webhook payloads or secrets.
- No Prisma schema or migration changes were made.


## Phase 3A.4 / 3A.5 implementation notes

- actorUserId is nullable in the existing Prisma model. HUMAN remains the default writer mode and requires an actor; SYSTEM requires an explicit systemSource and forbids a human actor ID.
- Refund webhook transitions are audited transactionally and guarded against duplicate or stale status transitions.
- Audit query validation now accepts any bounded entity type instead of a hard-coded five-value enum, so new audited modules remain queryable.
- Audit reads remain ADMIN-only and page size is capped at 100 with deterministic ordering by creation time and ID.
- Request IDs are carried using Node AsyncLocalStorage after pino-http establishes req.id; the audit writer merges the active request ID into metadata without replacing caller-supplied metadata.
- Audit data has no update/delete API. Database-enforced immutability, role grants, retention duration and bulk export remain explicit operational governance decisions; no production schema or privilege changes are made here.

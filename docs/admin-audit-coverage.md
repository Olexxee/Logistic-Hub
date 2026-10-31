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
3. **Full route-level authorization matrix:** audit coverage does not replace HTTP-level authorization tests. The 3A.1 inventory identifies missing route tests for several admin modules; those remain a separate acceptance item.
4. **Audit immutability and retention:** verify database privileges, retention policy, export and pagination controls separately. Application-level append-only usage is not equivalent to database-enforced immutability.
5. **Correlation/request IDs:** Express already generates `req.id` with `pino-http` and returns it as `X-Request-ID`. That identifier is not yet consistently passed through controllers/services into audit metadata. The audit schema has no dedicated request-ID column; adding end-to-end correlation requires a separate propagation pass and a decision on metadata versus a dedicated column.

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

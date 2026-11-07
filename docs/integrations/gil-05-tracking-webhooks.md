# GIL-05 — Tracking and Signed Webhooks

**Status:** GIL-04A–GIL-04E and GIL-05A–GIL-05B are merged. GIL-05C is implemented on the current pull request branch and awaiting CI/review. GIL-05D remains unimplemented.

## Objective

Expose a reliable, client-scoped shipment event history and deliver signed, retryable webhook notifications to each integration client. The integration must recover missed events without polling current shipment state indefinitely or trusting delivery order.

## Source-of-truth boundaries

- ParcelBooking, DeliveryLeg, partner assignment and custody records remain the operational source of truth.
- BookingEvent remains the internal audit/event record; it is not itself the external webhook contract.
- The integration event ledger is an immutable, sanitized projection for the owning integration client.
- Webhook delivery status is delivery telemetry only. A failed webhook must never roll back or block an operational shipment transition.
- Integrators use event ID and per-shipment sequence for deduplication and ordering. HTTP delivery order is not guaranteed.

## GIL-05A — Shipment event ledger and tracking API

### Contract

- Supported integration shipment milestones are projected into a durable IntegrationShipmentEvent in the same database transaction as their source operational mutation. The implementation explicitly projects shipment creation, partner assignment, partner leg start and the three mapped custody milestones.
- Event sequence is monotonic per shipment, starts at 1 and has no gaps for successfully committed integration events.
- The source BookingEvent ID is unique in the integration event ledger, preventing duplicate projection.
- Each event contains a stable event ID, schema version, external event type, per-shipment sequence, occurrence timestamp and a minimal sanitized payload containing shipment public reference and resulting status. Internal shipment IDs and leg/partner identifiers are not exposed in the payload.
- Payloads must not contain recipient phone/name, full pickup or destination addresses, package declared values, payment references, partner internal costs, credentials or secrets.
- Event history is scoped by authenticated integrationClientId and integration-owned booking identity. Unknown and other-client shipment IDs return the same not-found response.
- Tracking reads use sequence greater than afterSequence, ascending sequence order and a bounded page size. Clients persist the highest contiguous sequence they have processed.

### Initial event vocabulary

| Internal source event | External event |
|---|---|
| INTEGRATION_SHIPMENT_CREATED | shipment.created |
| INTEGRATION_PARTNER_ASSIGNMENT_CREATED | shipment.partner_assigned |
| INTEGRATION_PARTNER_LEG_STARTED | shipment.in_transit |
| HUB_PICKUP_CUSTODY_CONFIRMED | shipment.custody_handover_confirmed |
| HUB_DESTINATION_CUSTODY_CONFIRMED | shipment.delivery_leg_completed |
| PARTNER_HUB_CUSTODY_CONFIRMED | shipment.delivery_leg_completed |

Only events with an explicit mapping are externally visible. Internal audit events are not forwarded by default.

### Endpoint

GET /api/v1/integrations/shipments/:shipmentId/events?afterSequence=0&limit=50

Requires shipments:read. Response contains ordered events, hasMore and nextAfterSequence. The endpoint is read-only, requires shipments:read, scopes both booking and event queries to the authenticated client, and does not expose internal BookingEvent metadata.

## GIL-05B — Webhook endpoint and signing-secret management

- Implemented: endpoint listing, registration, subscription updates, suspension, reactivation, terminal revocation and secret rotation are scoped to the authenticated integration client and require the dedicated webhooks:manage scope. Every mutation writes a client/credential-attributed webhook audit record.
- Implemented: registration requires HTTPS on port 443, rejects URL credentials, query strings, fragments, IP literals and local/reserved hostnames, resolves DNS, and rejects the hostname if any A/AAAA result is not globally routable. DNS is checked again and pinned by the GIL-05C delivery worker before connecting; registration-time validation alone is not a DNS-rebinding defence.
- Implemented: signing secrets are shown once and stored only as AES-256-GCM ciphertext with a unique IV and authentication tag. The encryption key is supplied through WEBHOOK_SECRET_ENCRYPTION_KEY and must be a base64-encoded 32-byte key.
- Implemented: rotation increments the secret version and retains all prior encrypted versions. GIL-05C delivery records pin the exact secret version assigned when created.
- Implemented: endpoint suspension pauses pending deliveries; revocation prevents future delivery attempts. Revocation is terminal and does not erase event history.
- ADMIN can grant or revoke the webhooks:manage scope for an existing client through PATCH /api/v1/admin/integrations/:clientId/scopes; each scope change is audited.

## GIL-05C — Signed webhook delivery

- Implemented on the current branch: one durable delivery row per event/active subscribed endpoint is created in the same database transaction as the immutable event projection. The row pins the endpoint's exact signing-secret version and is unique by event/endpoint.
- Implemented: the embedded Node worker claims bounded batches using PostgreSQL `FOR UPDATE SKIP LOCKED`, a worker owner and expiring lease. Expired leases are reclaimable after a process crash.
- Implemented: the worker serializes a stable JSON envelope and signs the exact request body using HMAC-SHA256 over `timestamp + "." + rawBody`. The signature header is `X-Logistic-Hub-Signature: t=<unix-seconds>,v1=<hex-digest>`.
- Implemented headers: `X-Logistic-Hub-Event-Id`, `X-Logistic-Hub-Delivery-Id`, `X-Logistic-Hub-Event-Type`, `X-Logistic-Hub-Event-Sequence`, `X-Logistic-Hub-Timestamp` and `X-Logistic-Hub-Signature`.
- Implemented: redirects are not followed; the worker applies an 8-second request timeout, a 3-second DNS lookup timeout and a 4 KiB response-body cap. DNS is re-resolved for every attempt; every returned A/AAAA answer must be globally routable. The HTTPS socket connects to the selected validated IP while TLS certificate verification and SNI use the original hostname.
- Implemented: 2xx succeeds; network errors, timeouts, 408, 429 and 5xx retry with capped exponential backoff. Other 4xx/3xx responses, unsafe DNS answers, missing pinned secret versions and exhausted retries are dead-lettered. Attempts are capped at 8.
- Implemented: endpoint suspension pauses claimed deliveries; reactivation allows pending work to resume. Revocation and event unsubscription prevent pending work from being sent.
- Implemented: delivery failures do not alter the already-committed shipment transaction. Delivery is at-least-once; receivers must deduplicate by event ID and verify the timestamp/body HMAC using constant-time comparison.

## GIL-05D — Replay, operations and acceptance

- Client-scoped replay accepts an event ID or sequence range and requeues only deliveries for an active endpoint; replay does not create a new shipment event or sequence.
- Enforce bounded replay ranges and rate limits; every replay request is audited.
- Provide delivery status, attempt count, last HTTP status/error code, next attempt and terminal state without exposing secret material.
- Acceptance covers event projection atomicity, sequence ordering under concurrent updates, duplicate source-event suppression, cross-client isolation, signature correctness, secret rotation, endpoint SSRF controls, retry classification, lease recovery, dead-lettering, replay bounds and webhook/operational transaction independence.

## Implementation order

| Slice | Scope | Exit criteria |
|---|---|---|
| GIL-05A | Immutable event ledger and client-scoped tracking history | Atomic projection, per-shipment sequence, sanitized event payload and cursor-based tracking API |
| GIL-05B | Endpoint management and secret lifecycle | Implemented on the current branch: client-scoped endpoint CRUD, HTTPS/SSRF validation, one-time secret display, encrypted versioned rotation and audited scope administration |
| GIL-05C | Signed webhook worker | Implemented on the current PR branch: durable per-endpoint deliveries, HMAC signatures, DNS pinning, leases, retries and dead-lettering; pending CI/review |
| GIL-05D | Replay and acceptance | Bounded replay, audit trail, end-to-end contract and PostgreSQL concurrency tests |

GIL-05 does not change booking, payment, custody or partner execution authority. It does not enable Logistic Hub payment collection, refunds, wallet debits, payouts or settlement.


### GIL-05B deployment configuration

Generate a dedicated 32-byte encryption key and store it as the backend environment variable `WEBHOOK_SECRET_ENCRYPTION_KEY`. Do not reuse the email outbox key, commit the value, or expose it to the frontend. Example using Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Losing this key makes existing webhook signing secrets unrecoverable. Back it up using the deployment platform's secret-management facilities before enabling the `webhooks:manage` scope for an integration client.


### GIL-05C delivery operations

The delivery worker runs inside the existing API process; no additional Render service, Redis instance or paid worker plan is required. It starts only when `WEBHOOK_SECRET_ENCRYPTION_KEY` is configured. Delivery rows are stored in PostgreSQL and are claimed using row-level leases, so multiple API instances can safely compete for work. The endpoint's active state and event subscription are checked again before sending. Pending deliveries retain their pinned secret version across rotations.

The worker records delivery state, attempt count, last HTTP status, a bounded error code and the next retry time. GIL-05D will expose client-scoped delivery telemetry and replay controls; these are not part of GIL-05C.
